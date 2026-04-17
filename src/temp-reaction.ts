/**
 * Temporary Reaction — per-session, auto-reverts on any outbound action or timeout.
 *
 * Pattern: set 👀 to signal "reading", auto-restore to 🫡 (or remove)
 * the moment the agent sends anything outbound.
 *
 * Multiple temporary reactions can be active per session simultaneously.
 * Setting a new one appends to the list; `clearAllTempReactions` drains all.
 */

import { getBotReaction, hasBaseReaction, clearBaseReaction } from "./message-store.js";
import { resolveChat, trySetMessageReaction, getApi, type ReactionEmoji } from "./telegram.js";
import { getCallerSid } from "./session-context.js";

interface TempReactionSlot {
  chatId: number;
  messageId: number;
  restoreEmoji: ReactionEmoji | null; // null = remove reaction on restore
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// Map<sid, TempReactionSlot[]> — multiple slots per session
const _slots = new Map<number, TempReactionSlot[]>();

/**
 * Set a temporary reaction for the calling session. Appends to the active
 * slot list — multiple temp reactions per session are supported.
 * Fires `restoreEmoji` on restore; if omitted, restores the previous recorded
 * reaction (or removes it if none was recorded). Restore is triggered by the
 * first outbound event or after `timeoutSeconds`.
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

  // Look for an existing slot on the same message so we can inherit restoreEmoji
  const existingSlots = _slots.get(sid) ?? [];
  const sameMessageSlotIdx = existingSlots.findIndex(s => s.messageId === messageId);
  const inheritingSlot = sameMessageSlotIdx >= 0 ? existingSlots[sameMessageSlotIdx] : undefined;

  // When replacing a temp on the same message, cancel its timeout and remove the
  // old slot — we inherit the restore target to preserve the chain.
  if (inheritingSlot) {
    if (inheritingSlot.timeoutHandle !== null) clearTimeout(inheritingSlot.timeoutHandle);
    existingSlots.splice(sameMessageSlotIdx, 1);
    if (existingSlots.length === 0) {
      _slots.delete(sid);
    } else {
      _slots.set(sid, existingSlots);
    }
  }

  // Capture previous reaction before we overwrite it
  const previousEmoji = inheritingSlot !== undefined
    ? inheritingSlot.restoreEmoji
    : (getBotReaction(messageId) as ReactionEmoji | null);
  const resolvedRestore: ReactionEmoji | null =
    restoreEmoji !== undefined ? restoreEmoji : previousEmoji;

  const ok = await trySetMessageReaction(resolved, messageId, emoji);
  if (!ok) return false;

  const capturedSid = sid;
  const handle =
    timeoutSeconds != null
      ? setTimeout(() => { void _fireRestoreForSlot(capturedSid, messageId); }, timeoutSeconds * 1000)
      : null;

  const newSlot: TempReactionSlot = {
    chatId: resolved,
    messageId,
    restoreEmoji: resolvedRestore,
    timeoutHandle: handle,
  };

  const slots = _slots.get(sid) ?? [];
  slots.push(newSlot);
  _slots.set(sid, slots);

  return true;
}

/**
 * Internal: restore a single slot identified by (sid, messageId), then remove it.
 * Used by timeout callbacks where AsyncLocalStorage context is lost.
 *
 * When `restoreEmoji` is null (no explicit restore target was set) but a base 👌
 * reaction has been registered for this message, restores 👌 instead of clearing
 * to []. This is the mechanism that prevents the base reaction from overwriting an
 * active temp reaction via a racing async call.
 */
async function _fireRestoreForSlot(sid: number, messageId: number): Promise<void> {
  const slots = _slots.get(sid);
  if (!slots) return;
  const idx = slots.findIndex(s => s.messageId === messageId);
  if (idx < 0) return;
  const [slot] = slots.splice(idx, 1);
  if (slots.length === 0) _slots.delete(sid);

  const { chatId, restoreEmoji } = slot;
  const baseActive = hasBaseReaction(chatId, messageId);
  const effectiveRestore: ReactionEmoji | null =
    restoreEmoji ?? (baseActive ? "👌" as ReactionEmoji : null);
  if (effectiveRestore) {
    // Consume the base registration (one-shot) before firing, so a concurrent
    // clearAllTempReactions on remaining slots does not fire a duplicate 👌 (Fix 3).
    if (baseActive && !restoreEmoji) clearBaseReaction(chatId, messageId);
    void trySetMessageReaction(chatId, messageId, effectiveRestore).catch(() => undefined);
  } else {
    await getApi().setMessageReaction(chatId, messageId, []).catch(() => undefined);
  }
}

/**
 * Called by the outbound proxy before every send.
 * Restores ALL pending temporary reactions for this session, then clears all slots.
 * Safe to call unconditionally — no-ops when no slots are active.
 *
 * @param sid - Optional SID override. Pass the captured SID when calling from a
 *   setTimeout callback where AsyncLocalStorage context is lost. Falls back to
 *   `getCallerSid()` when not provided (normal outbound-proxy call path).
 */
export async function fireTempReactionRestore(sid?: number): Promise<void> {
  const resolvedSid = sid ?? getCallerSid();
  await clearAllTempReactions(resolvedSid);
}

/**
 * Clear ALL temporary reactions for the given session, firing restore for each.
 * Idempotent — safe to call when no slots are active.
 *
 * When a slot has no explicit `restoreEmoji` but the message has a registered
 * base 👌 reaction, restores 👌 instead of clearing to [].
 */
export async function clearAllTempReactions(sid: number): Promise<void> {
  const slots = _slots.get(sid);
  if (!slots || slots.length === 0) return;
  _slots.delete(sid);

  await Promise.all(slots.map(slot => {
    if (slot.timeoutHandle !== null) clearTimeout(slot.timeoutHandle);
    const { chatId, messageId, restoreEmoji } = slot;
    const baseActive = hasBaseReaction(chatId, messageId);
    const effectiveRestore: ReactionEmoji | null =
      restoreEmoji ?? (baseActive ? "👌" as ReactionEmoji : null);
    if (effectiveRestore) {
      // Consume the base registration (one-shot) so _fireRestoreForSlot (timeout
      // path) for any remaining slot on the same message does not fire a duplicate
      // 👌 API call (Fix 3).
      if (baseActive && !restoreEmoji) clearBaseReaction(chatId, messageId);
      return trySetMessageReaction(chatId, messageId, effectiveRestore).catch(() => undefined);
    } else {
      return getApi().setMessageReaction(chatId, messageId, []).catch(() => undefined);
    }
  }));
}

/** Returns true if any temporary reaction is currently pending for the calling session. */
export function hasTempReaction(): boolean {
  const slots = _slots.get(getCallerSid());
  return slots != null && slots.length > 0;
}

/** Test helper — resets all session state without firing any reaction. */
export function resetTempReactionForTest(): void {
  _slots.forEach(slotList => {
    slotList.forEach(s => { if (s.timeoutHandle !== null) clearTimeout(s.timeoutHandle); });
  });
  _slots.clear();
}
