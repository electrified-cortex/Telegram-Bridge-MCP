import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

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

export function register(server: McpServer) {
  server.registerTool(
    "set_reaction",
    {
      description: "Sets an emoji reaction on a message. Non-premium bots can set up to 1 reaction per message. Pass an empty string to remove all reactions. Supports semantic aliases like 'thinking', 'done', 'salute', or raw emoji. Use to acknowledge messages — e.g. 'approve' for confirmation, 'salute' for task complete, 'reading' for noted.",
      inputSchema: {
        message_id: z.number().int().describe("ID of the message to react to"),
      emoji: z
        .string()
        .optional()
        .describe("Emoji or semantic alias (e.g. 'thinking', 'done', 'salute', 'approve', 'ok', 'reading', 'fire', 'rocket', 'tada', 'heart'). Omit or pass empty string to remove reactions. Raw emoji also supported (👍 👎 ❤ 🔥 👏 😁 🤔 👀 ✍ 🫡 👾 and 50+ more)."),
      is_big: z
        .boolean()
        .optional()
        .describe("Use big animation (default false)"),
      },
    },
    async ({ message_id, emoji, is_big }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        // Resolve alias to emoji if provided
        const resolved = emoji ? resolveEmoji(emoji) : "";
        
        // Validate the resolved emoji
        if (resolved && !(ALLOWED_EMOJI as readonly string[]).includes(resolved)) {
          return toError({
            code: "BUTTON_DATA_INVALID" as const,
            message: `"${emoji}" → "${resolved}" is not an allowed reaction emoji.`,
          });
        }
        
        const reaction = resolved ? [{ type: "emoji" as const, emoji: resolved }] : [];
        await getApi().setMessageReaction(chatId, message_id, reaction as any, { is_big });
        return toResult({ ok: true, message_id, emoji: resolved || null });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
