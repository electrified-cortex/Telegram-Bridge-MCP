/**
 * Temporary Reaction — per-session, auto-reverts on any outbound action or timeout.
 *
 * Pattern: set 👀 to signal "reading", auto-restore to 🫡 (or remove)
 * the moment the agent sends anything outbound.
 *
 * Only one temporary reaction can be active per session at a time. Setting
 * a new one while one is pending replaces the previous one (no restore fired
 * for the replaced slot — caller is responsible for overlapping calls).
 */

import { getBotReaction } from "./message-store.js";
import { resolveChat, trySetMessageReaction, getApi, type ReactionEmoji } from "./telegram.js";
import { getCallerSid } from "./session-context.js";

interface TempReactionSlot {
  chatId: number;
  messageId: number;
  restoreEmoji: ReactionEmoji | null; // null = remove reaction on restore
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

const _slots = new Map<number, TempReactionSlot>();

/**
 * Set a temporary reaction for the calling session. Fires `restoreEmoji` on
 * restore; if omitted, restores the previous recorded reaction (or removes it
 * if none was recorded). Restore is triggered by the first outbound event or
 * after `timeoutSeconds`.
 */
export async function setTempReaction(
  messageId: number,
  emoji: ReactionEmoji,
  restoreEmoji?: ReactionEmoji,
  timeoutSeconds?: number,
): Promise<boolean> {
  const resolved = resolveChat();
  if (typeof resolved !== "number") return false;

  const sid = getCallerSid();
  // Cancel any previous pending slot for this session (no restore — caller replaced it)
  _clearSlot(sid);

  // Capture previous reaction before we overwrite it
  const previousEmoji = getBotReaction(messageId) as ReactionEmoji | null;
  const resolvedRestore: ReactionEmoji | null =
    restoreEmoji !== undefined ? restoreEmoji : previousEmoji;

  const ok = await trySetMessageReaction(resolved, messageId, emoji);
  if (!ok) return false;

  const capturedSid = sid;
  const handle =
    timeoutSeconds != null
      ? setTimeout(() => { void fireTempReactionRestore(capturedSid); }, timeoutSeconds * 1000)
      : null;

  _slots.set(sid, {
    chatId: resolved,
    messageId,
    restoreEmoji: resolvedRestore,
    timeoutHandle: handle,
  });

  return true;
}

/**
 * Called by the outbound proxy before every send.
 * Restores the reaction to its pre-temp state, then clears the slot.
 * - If restoreEmoji is set, reverts to it.
 * - If null (no previous reaction recorded), clears the reaction entirely.
 * Safe to call unconditionally — no-ops when no slot is active for this session.
 *
 * @param sid - Optional SID override. Pass the captured SID when calling from a
 *   setTimeout callback where AsyncLocalStorage context is lost. Falls back to
 *   `getCallerSid()` when not provided (normal outbound-proxy call path).
 */
export async function fireTempReactionRestore(sid?: number): Promise<void> {
  const resolvedSid = sid ?? getCallerSid();
  const slot = _slots.get(resolvedSid);
  if (!slot) return;
  const { chatId, messageId, restoreEmoji } = slot;
  _clearSlot(resolvedSid);

  if (restoreEmoji) {
    void trySetMessageReaction(chatId, messageId, restoreEmoji);
  } else {
    // No previous reaction — clear back to nothing
    await getApi().setMessageReaction(chatId, messageId, []).catch(() => undefined);
  }
}

function _clearSlot(sid: number): void {
  const slot = _slots.get(sid);
  if (!slot) return;
  if (slot.timeoutHandle !== null) clearTimeout(slot.timeoutHandle);
  _slots.delete(sid);
}

/** Returns true if a temporary reaction is currently pending for the calling session. */
export function hasTempReaction(): boolean {
  return _slots.has(getCallerSid());
}

/** Test helper — resets all session state without firing any reaction. */
export function resetTempReactionForTest(): void {
  _slots.forEach(s => { if (s.timeoutHandle !== null) clearTimeout(s.timeoutHandle); });
  _slots.clear();
}
