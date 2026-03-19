import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReactionType } from "grammy/types";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, type ReactionEmoji } from "../telegram.js";
import { recordBotReaction } from "../message-store.js";
import { setTempReaction } from "../temp-reaction.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

/**
 * Allowed emoji reactions from the Telegram Bot API.
 * Non-premium bots can set up to 1 reaction per message.
 */
const ALLOWED_EMOJI = [
  "👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢",
  "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳",
  "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓",
  "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈",
  "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿",
  "🚀", "⏳", "✅", "⛔", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡",
] as const;

/**
 * Semantic aliases for common reactions.
 * Maps friendly names to canonical emoji.
 */
const REACTION_ALIASES: Record<string, string> = {
  // Status/Progress
  thinking: "🤔",
  working: "⏳",
  processing: "⏳",
  busy: "⏳",
  done: "✅",
  complete: "✅",
  finished: "✅",
  error: "⛔",
  failed: "⛔",
  stop: "⛔",
  blocked: "⛔",
  
  // Approval/Feedback/Acknowledgment
  approve: "👍",
  yes: "👍",
  good: "👍",
  ok: "👌",
  okay: "👌",
  salute: "🫡",
  acknowledged: "🫡",
  understood: "🫡",
  heart: "❤",
  love: "❤",
  reject: "👎",
  no: "👎",
  bad: "👎",
  
  // Observation
  reading: "👀",
  looking: "👀",
  watching: "👀",
  
  // Excitement
  fire: "🔥",
  hot: "🔥",
  rocket: "🚀",
  launch: "🚀",
  tada: "🎉",
  celebrate: "🎉",
  party: "🎉",
};

/**
 * Resolve an alias or raw emoji to a canonical emoji.
 * If already an allowed emoji, returns it unchanged.
 */
function resolveEmoji(input: string): string {
  const alias = REACTION_ALIASES[input.toLowerCase()];
  if (alias) return alias;
  return input;
}

const DESCRIPTION =
  "Sets an emoji reaction on a message. Non-premium bots can set up to 1 " +
  "reaction per message. Pass an empty string to remove all reactions. " +
  "Supports semantic aliases like 'thinking', 'done', 'salute', or raw emoji. " +
  "Set temporary=true to auto-revert the reaction on the next outbound " +
  "action (or after timeout_seconds). Optionally specify restore_emoji to " +
  "revert to a specific emoji instead of removing the reaction. " +
  "Classic use: set 'reading' (👀) with temporary=true to signal " +
  "'processing' and auto-clear once you reply.";

export function register(server: McpServer) {
  server.registerTool(
    "set_reaction",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().min(1).describe("ID of the message to react to"),
        emoji: z
          .string()
          .optional()
          .describe("Emoji or semantic alias (e.g. 'thinking', 'done', 'salute', 'approve', 'ok', 'reading', 'fire', 'rocket', 'tada', 'heart'). Omit or pass empty string to remove reactions. Raw emoji also supported (👍 👎 ❤ 🔥 👏 😁 🤔 👀 ✍ 🫡 👾 and 50+ more)."),
        is_big: z
          .boolean()
          .optional()
          .describe("Use big animation (default false). Only applies to permanent reactions."),
        temporary: z
          .boolean()
          .optional()
          .describe(
            "When true, the reaction auto-reverts on the next outbound " +
            "action or after timeout_seconds. Defaults to false.",
          ),
        restore_emoji: z
          .string()
          .optional()
          .describe(
            "Emoji/alias to revert to when a temporary reaction expires. " +
            "Omit to remove the reaction on restore. " +
            "Implies temporary=true.",
          ),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Deadline in seconds before auto-restore fires " +
            "(e.g. 300 = 5 min). Fires on whichever comes first: " +
            "next outbound action or this timeout. " +
            "Implies temporary=true.",
          ),
              identity: IDENTITY_SCHEMA,
},
    },
    async ({ message_id, emoji, is_big, temporary, restore_emoji, timeout_seconds, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        // Resolve alias to emoji if provided
        const resolved = emoji ? resolveEmoji(emoji) : "";

        // Validate the resolved emoji
        if (resolved && !(ALLOWED_EMOJI as readonly string[]).includes(resolved)) {
          return toError({
            code: "REACTION_EMOJI_INVALID" as const,
            message: `"${emoji}" → "${resolved}" is not an allowed reaction emoji.`,
          });
        }

        // Temporary reaction path
        const isTemp = temporary === true
          || restore_emoji !== undefined
          || timeout_seconds !== undefined;
        if (isTemp) {
          if (!resolved) {
            return toError({ code: "REACTION_EMOJI_INVALID" as const, message: "emoji is required for temporary reactions." });
          }
          let restoreResolved: ReactionEmoji | undefined;
          if (restore_emoji) {
            const r = resolveEmoji(restore_emoji);
            if (!(ALLOWED_EMOJI as readonly string[]).includes(r)) {
              return toError({ code: "REACTION_EMOJI_INVALID" as const, message: `restore_emoji "${restore_emoji}" → "${r}" is not an allowed reaction emoji.` });
            }
            restoreResolved = r as ReactionEmoji;
          }
          const ok = await setTempReaction(message_id, resolved as ReactionEmoji, restoreResolved, timeout_seconds);
          if (!ok) return toError({ code: "UNKNOWN" as const, message: "Failed to set reaction — message may be too old or unavailable." });
          recordBotReaction(message_id, resolved);
          return toResult({ ok: true, message_id, emoji: resolved, temporary: true, restore_emoji: restoreResolved ?? null, timeout_seconds: timeout_seconds ?? null });
        }

        // Permanent reaction path
        const reaction: ReactionType[] = resolved ? [{ type: "emoji" as const, emoji: resolved as ReactionEmoji }] : [];
        await getApi().setMessageReaction(chatId, message_id, reaction, { is_big });
        if (resolved) recordBotReaction(message_id, resolved);
        return toResult({ ok: true, message_id, emoji: resolved || null, temporary: false });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
