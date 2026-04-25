import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, type ReactionEmoji } from "../../telegram.js";
import { recordBotReaction, hasBaseReaction, markBaseReaction } from "../../message-store.js";
import { setTempReaction } from "../../temp-reaction.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { isTemporaryByDefault, getReactionPreset, listReactionPresets } from "../../reaction-presets.js";

const REACTION_ITEM_SCHEMA = z.object({
  emoji: z.string().describe("Emoji or semantic alias"),
  priority: z.number().int().default(0).describe("Layer priority: negative = permanent base, 0 = standard temp"),
  temporary: z.boolean().optional().describe("Whether this auto-reverts. Defaults false for priority < 0, true for priority >= 0."),
});

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
 * Maps unsupported (non-Telegram-reaction) emoji to the closest semantic alias
 * that IS in ALLOWED_EMOJI. Used by the single-emoji path; routes through normal
 * temporary/permanent logic.
 *
 * Entries here must NOT appear in ALLOWED_EMOJI — they are emoji agents commonly
 * reach for that Telegram does not accept as reactions.
 * Values MUST be present in ALLOWED_EMOJI.
 *
 * When a match is found the bridge substitutes the alias target and falls through into the
 * normal routing logic (so temporary/timeout_seconds/TEMPORARY_BY_DEFAULT all apply).
 * The result includes hint:"emoji_alias_applied" so the caller knows about the substitution.
 */
const UNSUPPORTED_EMOJI_ALIASES: Record<string, string | undefined> = {
  "👂": "👀", // ear (listening) → eyes (watching/processing); note: 👀 is in TEMPORARY_BY_DEFAULT
  "🤚": "👍", // raised hand → thumbs up (acknowledgment)
  "🧠": "🤔", // brain (thinking) → thinking face
  "👁": "👀", // single eye → eyes; note: 👀 is in TEMPORARY_BY_DEFAULT
  "🦻": "👀", // ear with hearing aid → eyes; note: 👀 is in TEMPORARY_BY_DEFAULT
};

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
  "Use `reactions` array for atomic multi-layer reactions (permanent base + temp overlay). " +
  "Call `help(topic: 'set_reaction')` for details.";

type ReactionItem = z.infer<typeof REACTION_ITEM_SCHEMA>;

async function handleSetReactionArray(
  args: { message_id: number; reactions: ReactionItem[]; timeout_seconds?: number; token: number },
  chatId: number,
  _sid: number,
) {
  const { message_id, reactions, timeout_seconds } = args;

  // Fix 3: Reject empty reactions array with a clear error
  if (reactions.length === 0) {
    return toError({ code: "REACTION_ARRAY_EMPTY" as const, message: "reactions array must not be empty. Pass at least one reaction item." });
  }

  // Validate and resolve all emoji up-front before any API call
  // Store candidates array for each item so fallback logic can be applied later
  const resolved: Array<{ emoji: string; candidates: string[]; priority: number; temporary: boolean }> = [];
  for (const item of reactions) {
    const r = resolveEmoji(item.emoji);
    if (!r) {
      return toError({
        code: "REACTION_EMOJI_INVALID" as const,
        message: `"${item.emoji}" is not an allowed reaction emoji.`,
      });
    }
    // Default temporary: false for priority < 0, true for priority >= 0
    const isTemp = item.temporary !== undefined ? item.temporary : item.priority >= 0;
    resolved.push({ emoji: r[0], candidates: r, priority: item.priority, temporary: isTemp });
  }

  // Check for multiple temp items (unsupported)
  const tempItems = resolved.filter(r => r.temporary);
  if (tempItems.length > 1) {
    return toError({
      code: "REACTION_MULTI_TEMP_UNSUPPORTED" as const,
      message: "Multiple temporary reaction layers are not supported. Provide at most one item with priority >= 0 (or temporary: true).",
    });
  }

  // Sort by priority ascending (lowest first)
  resolved.sort((a, b) => a.priority - b.priority);

  // Helper: try emoji candidates in order, same fallback pattern as single-emoji path
  async function tryWithFallback(candidates: string[]): Promise<string | null> {
    for (const [i, candidate] of candidates.entries()) {
      try {
        await getApi().setMessageReaction(chatId, message_id, [{ type: "emoji" as const, emoji: candidate as ReactionEmoji }], {});
        if (PREMIUM_EMOJI.has(candidate)) _botIsPremium = true;
        return candidate;
      } catch (err) {
        const isLast = i === candidates.length - 1;
        if (isReactionInvalid(err) && !isLast) {
          if (PREMIUM_EMOJI.has(candidate)) _botIsPremium = false;
          continue;
        }
        return null;
      }
    }
    return null;
  }

  // Strip candidates from layers output (internal detail)
  const layers = resolved.map(({ emoji, priority, temporary }) => ({ emoji, priority, temporary }));

  // All permanent path (no temp items)
  if (tempItems.length === 0) {
    // Apply the highest-priority permanent item directly, with fallback
    const top = resolved[resolved.length - 1];
    const usedEmoji = await tryWithFallback(top.candidates);
    if (!usedEmoji) {
      return toError({ code: "UNKNOWN" as const, message: "Failed to set permanent reaction." });
    }
    recordBotReaction(message_id, usedEmoji);
    _insertBaseReaction(chatId, message_id);
    // Fix 4: Warn when multiple permanent items were provided but only one can be applied
    const note = resolved.length > 1 ? ` (only highest-priority item applied — Telegram supports 1 reaction)` : "";
    return toResult({ ok: true, visible: usedEmoji, layers, restore_emoji: null, note: note || undefined });
  }

  // Mixed path: permanent base + temp overlay
  const baseItem = resolved.find(r => !r.temporary);
  // Fix 2: Use tempItems[0] for topItem — exactly one temp item is guaranteed here
  const topItem = tempItems[0];

  // Resolve the temp item emoji with fallback to get the actual emoji to display
  let resolvedTopEmoji = topItem.emoji;
  if (topItem.candidates.length > 1 && _botIsPremium === false) {
    const free = topItem.candidates.filter(c => !PREMIUM_EMOJI.has(c));
    resolvedTopEmoji = free.length > 0 ? free[0] : topItem.emoji;
  }

  // Fix 1: Capture restoreEmoji before the API call, but defer recordBotReaction until after success
  let restoreEmoji: ReactionEmoji | undefined;
  if (baseItem) {
    // Resolve base emoji with fallback
    let resolvedBaseEmoji = baseItem.emoji;
    if (baseItem.candidates.length > 1 && _botIsPremium === false) {
      const free = baseItem.candidates.filter(c => !PREMIUM_EMOJI.has(c));
      resolvedBaseEmoji = free.length > 0 ? free[0] : baseItem.emoji;
    }
    restoreEmoji = resolvedBaseEmoji as ReactionEmoji;
  }

  const ok = await setTempReaction(message_id, resolvedTopEmoji as ReactionEmoji, restoreEmoji, timeout_seconds);
  if (!ok) return toError({ code: "UNKNOWN" as const, message: "Failed to set reaction — message may be too old or unavailable." });

  // Fix 1: Only record the bot reaction after setTempReaction succeeds
  if (baseItem && restoreEmoji) {
    recordBotReaction(message_id, restoreEmoji);
  }
  // Temp reaction is now active — register 👌 base locally but do NOT make an API
  // call (it would overwrite the visible temp). The temp-reaction restore path will
  // apply 👌 when the last temp expires.
  _insertBaseReaction(chatId, message_id);

  return toResult({
    ok: true,
    visible: resolvedTopEmoji,
    layers,
    restore_emoji: restoreEmoji ?? null,
  });
}

/**
 * Register the implicit 👌 base reaction for this (chatId, messageId) pair.
 * Idempotent — no-ops if already registered.
 *
 * When applyNow is true the 👌 API call is made immediately (all-permanent preset path).
 * Otherwise base is virtual — surfaces only when the last temporary expires.
 */
function _insertBaseReaction(chatId: number, messageId: number, applyNow = false): void {
  if (hasBaseReaction(chatId, messageId)) return;
  markBaseReaction(chatId, messageId);
  if (applyNow) {
    void getApi().setMessageReaction(chatId, messageId, [{ type: "emoji" as const, emoji: "👌" }], {});
  }
}

/**
 * Apply a named reaction preset to a message.
 * Presets are multi-layer reactions fired sequentially.
 */
export async function handleSetReactionPreset(
  sessionId: number,
  chatId: number,
  messageId: number,
  presetName: string,
): Promise<ReturnType<typeof toError> | ReturnType<typeof toResult>> {
  const entries = getReactionPreset(presetName);
  if (!entries) {
    return toError({
      code: "UNKNOWN" as const,
      message: `Unknown reaction preset "${presetName}". Available: ${listReactionPresets().join(', ')}.`,
    });
  }

  const results: string[] = [];

  // Sort by priority ascending
  const sorted = [...entries].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  let hasTempEntry = false;
  for (const entry of sorted) {
    const candidates = resolveEmoji(entry.emoji);
    if (!candidates) continue;
    const emoji = candidates[0] as ReactionEmoji;

    if (entry.temporary) {
      hasTempEntry = true;
      await setTempReaction(messageId, emoji, undefined, entry.timeout_seconds);
      // Do NOT recordBotReaction for temp entries — the stable "bot reaction"
      // should reflect the permanent base, not transient temps. Recording a temp
      // emoji here would mislead chained-preset restore (Fix 4).
    } else {
      try {
        await getApi().setMessageReaction(chatId, messageId, [{ type: "emoji" as const, emoji }], {});
        recordBotReaction(messageId, emoji);
      } catch {
        // Suppress individual layer failures
      }
    }
    results.push(emoji);
  }

  // Register the virtual 👌 base only when at least one temp entry was applied.
  // The temp-reaction restore path will apply 👌 when the last temp expires.
  // If all entries are permanent there is no temp to restore, so no base is needed.
  if (hasTempEntry) _insertBaseReaction(chatId, messageId);

  return toResult({ ok: true, applied: results });
}

export async function handleSetReaction(args: {
  message_id: number;
  reactions?: ReactionItem[];
  emoji?: string;
  is_big?: boolean;
  temporary?: boolean;
  restore_emoji?: string;
  timeout_seconds?: number;
  token: number;
}) {
  const { message_id, emoji, is_big, temporary, restore_emoji, timeout_seconds, token } = args;
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  // Array-based reaction path (also catches empty arrays to return a clear error)
  if (args.reactions !== undefined) {
    return handleSetReactionArray({ message_id, reactions: args.reactions, timeout_seconds, token }, chatId, _sid);
  }
  try {
    // Resolve alias or raw emoji → ordered candidate array
    let candidates: string[] = [];
    let originalFirst: string | undefined;
    // Set when an unsupported emoji was remapped via UNSUPPORTED_EMOJI_ALIASES.
    // The hint fields are injected into the final toResult(...) call below.
    let aliasHint: { original: string; target: string } | undefined;
    if (emoji) {
      let resolved = resolveEmoji(emoji);
      if (!resolved) {
        // Check UNSUPPORTED_EMOJI_ALIASES before returning an error.
        // If found, substitute the alias target and fall through into the normal
        // routing logic (so temporary/timeout_seconds/TEMPORARY_BY_DEFAULT all apply).
        const aliasTarget = UNSUPPORTED_EMOJI_ALIASES[emoji];
        if (aliasTarget !== undefined) {
          aliasHint = { original: emoji, target: aliasTarget };
          resolved = resolveEmoji(aliasTarget) ?? [aliasTarget];
        } else {
          return toError({
            code: "REACTION_EMOJI_INVALID" as const,
            message: `"${emoji}" is not an allowed reaction emoji.`,
          });
        }
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
    // Also treat as temporary when `temporary` is not set and the emoji is in
    // TEMPORARY_BY_DEFAULT (🤔 👀 ⏳ ✍️ 👨‍💻). Explicit `temporary: false` overrides.
    const resolvedFirst = candidates[0];
    const defaultTemp = temporary === undefined && isTemporaryByDefault(resolvedFirst);
    const isTemp = temporary === true
      || defaultTemp
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
      // Temp reaction is now active — register 👌 base locally but do NOT make an API
      // call (it would overwrite the visible temp). The temp-reaction restore path will
      // apply 👌 when the last temp expires.
      _insertBaseReaction(chatId, message_id);
      const tempResult: Record<string, unknown> = { ok: true, temporary: true, restore_emoji: restoreResolved ?? null, timeout_seconds: timeout_seconds ?? null };
      if (aliasHint) {
        const hint_detail = `${aliasHint.original} is not a supported Telegram reaction. Used ${aliasHint.target} (closest semantic alias). The fallback uses the same temporality rules as the alias target directly.`;
        tempResult.hint = "emoji_alias_applied";
        tempResult.hint_detail = hint_detail;
        tempResult.applied = [aliasHint.target];
      }
      return toResult(tempResult);
    }

    // Permanent reaction — clear if no emoji given
    if (candidates.length === 0) {
      await getApi().setMessageReaction(chatId, message_id, [], { is_big });
      return toResult({ ok: true, temporary: false });
    }

    // Permanent reaction — try candidates in order, fall back on REACTION_INVALID
    for (const [i, candidate] of candidates.entries()) {
      try {
        await getApi().setMessageReaction(chatId, message_id, [{ type: "emoji" as const, emoji: candidate as ReactionEmoji }], { is_big });
        recordBotReaction(message_id, candidate);
        if (PREMIUM_EMOJI.has(candidate)) _botIsPremium = true;
        _insertBaseReaction(chatId, message_id);
        const result: Record<string, unknown> = { ok: true, temporary: false };
        if (candidate !== originalFirst) {
          result.requested = originalFirst;
          result.fallback_used = true;
          result.reason = "The preferred emoji requires Telegram Premium. Used the closest free alternative.";
        }
        if (aliasHint) {
          const hint_detail = `${aliasHint.original} is not a supported Telegram reaction. Used ${aliasHint.target} (closest semantic alias). The fallback uses the same temporality rules as the alias target directly.`;
          result.hint = "emoji_alias_applied";
          result.hint_detail = hint_detail;
          result.applied = [aliasHint.target];
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
        reactions: z.array(REACTION_ITEM_SCHEMA).optional()
          .describe("Array of reaction layers applied atomically. Priority -1 = permanent base, 0 = standard temp overlay."),
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
