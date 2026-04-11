import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, type ReactionEmoji } from "../telegram.js";
import { recordBotReaction } from "../message-store.js";
import { setTempReaction } from "../temp-reaction.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

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
 * Emoji reactions that require Telegram Premium on the bot account.
 * Used for fallback logic: non-premium bots cannot set these.
 */
const PREMIUM_EMOJI = new Set<string>(["✅"]);

/**
 * Cached premium status for this process lifetime.
 * null = not yet determined, true = premium bot, false = non-premium bot.
 */
let _botIsPremium: boolean | null = null;

/** Reset premium status cache (for testing only). */
export function resetPremiumCacheForTest(): void {
  _botIsPremium = null;
}

/**
 * Semantic aliases mapped to ordered fallback arrays.
 * First element is preferred; subsequent elements are tried on REACTION_INVALID.
 * Aliases with a single element have no fallback (always work for free bots).
 */
const REACTION_ALIASES: Record<string, string[]> = {
  // Premium-preferred with free fallback
  done:     ["✅", "👍"],
  complete: ["✅", "👍"],
  finished: ["✅", "👍"],
  error:    ["⛔", "👎"],
  failed:   ["⛔", "👎"],
  stop:     ["⛔", "👎"],
  blocked:  ["⛔", "👎"],
  rocket:   ["🚀", "🔥"],
  launch:   ["🚀", "🔥"],

  // Free-only aliases — single element, always work
  thinking: ["🤔"],
  working: ["⏳"],
  processing: ["⏳"],
  busy: ["⏳"],
  approve: ["👍"],
  yes: ["👍"],
  good: ["👍"],
  ok: ["👌"],
  okay: ["👌"],
  salute: ["🫡"],
  acknowledged: ["🫡"],
  understood: ["🫡"],
  heart: ["❤"],
  love: ["❤"],
  reject: ["👎"],
  no: ["👎"],
  bad: ["👎"],
  reading: ["👀"],
  looking: ["👀"],
  watching: ["👀"],
  fire: ["🔥"],
  hot: ["🔥"],
  tada: ["🎉"],
  celebrate: ["🎉"],
  party: ["🎉"],
};

/**
 * Return true when a caught error is a Telegram REACTION_INVALID response.
 * This indicates the emoji requires Telegram Premium and the bot lacks it.
 */
function isReactionInvalid(err: unknown): boolean {
  if (typeof err !== "object" || !err) return false;
  const desc = (err as { description?: unknown }).description;
  return typeof desc === "string" && desc.includes("REACTION_INVALID");
}

/**
 * Resolve an alias or raw emoji to an ordered list of candidates.
 * Returns null if the input is neither a known alias nor an allowed emoji.
 * Direct emoji input → single-element array (no fallback).
 */
function resolveEmoji(input: string): string[] | null {
  const key = input.toLowerCase();
  if (key in REACTION_ALIASES) return REACTION_ALIASES[key];
  if ((ALLOWED_EMOJI as readonly string[]).includes(input)) return [input];
  return null;
}

const DESCRIPTION =
  "Set an emoji reaction on a message (max 1 for non-premium bots). " +
  "Accepts aliases (thinking, done, salute, reading, approve…) or raw emoji; omit/empty to remove. " +
  "temporary=true auto-reverts on next outbound action or timeout_seconds. " +
  "Call `help(topic: 'set_reaction')` for details.";

export async function handleSetReaction({ message_id, emoji, is_big, temporary, restore_emoji, timeout_seconds, token }: {
  message_id: number;
  emoji?: string;
  is_big?: boolean;
  temporary?: boolean;
  restore_emoji?: string;
  timeout_seconds?: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  try {
    // Resolve alias or raw emoji → ordered candidate array
    let candidates: string[] = [];
    let originalFirst: string | undefined;
    if (emoji) {
      const resolved = resolveEmoji(emoji);
      if (!resolved) {
        return toError({
          code: "REACTION_EMOJI_INVALID" as const,
          message: `"${emoji}" is not an allowed reaction emoji.`,
        });
      }
      originalFirst = resolved[0];
      // Premium shortcut: skip known premium-only emojis for non-premium bots
      if (_botIsPremium === false && resolved.length > 1) {
        const free = resolved.filter(c => !PREMIUM_EMOJI.has(c));
        candidates = free.length > 0 ? free : resolved;
      } else {
        candidates = resolved;
      }
    }

    // Temporary reaction path — use first (preferred) candidate only, no fallback
    const isTemp = temporary === true
      || restore_emoji !== undefined
      || timeout_seconds !== undefined;
    if (isTemp) {
      const [primary] = candidates;
      if (!primary) {
        return toError({ code: "REACTION_EMOJI_INVALID" as const, message: "emoji is required for temporary reactions. Pass an emoji or semantic alias (e.g. 'thinking', 'done')." });
      }
      let restoreResolved: ReactionEmoji | undefined;
      if (restore_emoji) {
        const r = resolveEmoji(restore_emoji);
        if (!r) {
          return toError({ code: "REACTION_EMOJI_INVALID" as const, message: `restore_emoji "${restore_emoji}" is not an allowed reaction emoji.` });
        }
        restoreResolved = r[0] as ReactionEmoji;
      }
      const ok = await setTempReaction(message_id, primary as ReactionEmoji, restoreResolved, timeout_seconds);
      if (!ok) return toError({ code: "UNKNOWN" as const, message: "Failed to set reaction — message may be too old or unavailable." });
      recordBotReaction(message_id, primary);
      return toResult({ ok: true, message_id, emoji: primary, temporary: true, restore_emoji: restoreResolved ?? null, timeout_seconds: timeout_seconds ?? null });
    }

    // Permanent reaction — clear if no emoji given
    if (candidates.length === 0) {
      await getApi().setMessageReaction(chatId, message_id, [], { is_big });
      return toResult({ ok: true, message_id, emoji: null, temporary: false });
    }

    // Permanent reaction — try candidates in order, fall back on REACTION_INVALID
    for (const [i, candidate] of candidates.entries()) {
      try {
        await getApi().setMessageReaction(chatId, message_id, [{ type: "emoji" as const, emoji: candidate as ReactionEmoji }], { is_big });
        recordBotReaction(message_id, candidate);
        if (PREMIUM_EMOJI.has(candidate)) _botIsPremium = true;
        const result: Record<string, unknown> = { ok: true, message_id, emoji: candidate, temporary: false };
        if (candidate !== originalFirst) {
          result.requested = originalFirst;
          result.fallback_used = true;
          result.reason = "The preferred emoji requires Telegram Premium. Used the closest free alternative.";
        }
        return toResult(result);
      } catch (err) {
        const isLast = i === candidates.length - 1;
        if (isReactionInvalid(err) && !isLast) {
          if (PREMIUM_EMOJI.has(candidate)) _botIsPremium = false;
          continue;
        }
        throw err;
      }
    }
    // Unreachable — loop above always returns or throws
    throw new Error("reaction fallback loop exhausted");
  } catch (err) {
    return toError(err);
  }
}

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
        token: TOKEN_SCHEMA,
      },
    },
    handleSetReaction,
  );
}
