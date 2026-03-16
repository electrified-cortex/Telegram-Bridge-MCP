/**
 * Temporary Reaction — auto-reverts on any outbound action or timeout.
 *
 * Pattern: set 👀 to signal "reading", auto-restore to 🫡 (or remove)
 * the moment the agent sends anything outbound.
 *
 * Only one temporary reaction can be active at a time. Setting a new one
 * while one is pending replaces the previous one (no restore fired for
 * the replaced slot — caller is responsible for overlapping calls).
 */

import { getBotReaction } from "./message-store.js";
import { resolveChat, trySetMessageReaction, getApi, type ReactionEmoji } from "./telegram.js";

interface TempReactionSlot {
  chatId: number;
  messageId: number;
  restoreEmoji: ReactionEmoji | null; // null = remove reaction on restore
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

let _slot: TempReactionSlot | null = null;

/**
 * Set a temporary reaction. Fires `restoreEmoji` on restore; if omitted,
 * restores the previous recorded reaction (or removes it if none was recorded).
 * Restore is triggered by the first outbound event or after `timeoutSeconds`.
 */
export async function setTempReaction(
  messageId: number,
  emoji: ReactionEmoji,
  restoreEmoji?: ReactionEmoji,
  timeoutSeconds?: number,
): Promise<boolean> {
  const resolved = resolveChat();
  if (typeof resolved !== "number") return false;

  // Cancel any previous pending slot (no restore — caller replaced it)
  _clearSlot(false);

  // Capture previous reaction before we overwrite it
  const previousEmoji = getBotReaction(messageId) as ReactionEmoji | null;
  const resolvedRestore: ReactionEmoji | null =
    restoreEmoji !== undefined ? restoreEmoji : previousEmoji;

  const ok = await trySetMessageReaction(resolved, messageId, emoji);
  if (!ok) return false;

  const handle =
    timeoutSeconds != null
      ? setTimeout(() => { void fireTempReactionRestore(); }, timeoutSeconds * 1000)
      : null;

  _slot = {
    chatId: resolved,
    messageId,
    restoreEmoji: resolvedRestore,
    timeoutHandle: handle,
  };

  return true;
}

/**
 * Called by the outbound proxy before every send.
 * Restores the reaction to its pre-temp state, then clears the slot.
 * - If restoreEmoji is set, reverts to it.
 * - If null (no previous reaction recorded), clears the reaction entirely.
 * Safe to call unconditionally — no-ops when no slot is active.
 */
export async function fireTempReactionRestore(): Promise<void> {
  if (!_slot) return;
  const { chatId, messageId, restoreEmoji } = _slot;
  _clearSlot(false);

  if (restoreEmoji) {
    void trySetMessageReaction(chatId, messageId, restoreEmoji);
  } else {
    // No previous reaction — clear back to nothing
    await getApi().setMessageReaction(chatId, messageId, []).catch(() => undefined);
  }
}

function _clearSlot(fireRestore: boolean): void {
  if (!_slot) return;
  if (_slot.timeoutHandle !== null) clearTimeout(_slot.timeoutHandle);
  if (fireRestore) {
    const { chatId, messageId, restoreEmoji } = _slot;
    _slot = null;
    if (restoreEmoji) {
      void trySetMessageReaction(chatId, messageId, restoreEmoji);
    } else {
      // null = remove reaction on restore (consistent with fireTempReactionRestore)
      void getApi().setMessageReaction(chatId, messageId, []).catch(() => undefined);
    }
  } else {
    _slot = null;
  }
}

/** Returns true if a temporary reaction is currently pending. */
export function hasTempReaction(): boolean {
  return _slot !== null;
}

/** Test helper — resets state without firing any reaction. */
export function resetTempReactionForTest(): void {
  if (_slot?.timeoutHandle !== null) clearTimeout(_slot?.timeoutHandle);
  _slot = null;
}
