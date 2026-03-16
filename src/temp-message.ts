/**
 * Temporary message tracker.
 *
 * A temp message is a short status like "Thinking…" that should vanish
 * shortly after the agent sends a real response. Two things can delete it:
 *
 *   1. Any outbound tool calls clearPendingTemp() — schedules deletion after
 *      a short grace period so the user can still read it.
 *   2. The TTL timer fires — safety net if the agent goes silent.
 *
 * Storing in-process is intentional: we accept the tradeoff that a server
 * restart orphans the message. These are ephemeral "Thinking…" placeholders,
 * not important content, so consistency guarantees would be overkill.
 */

import { getApi } from "./telegram.js";

/** Seconds the temp message lingers after clearPendingTemp() so the user can still read it. */
const GRACE_SECONDS = 10;

interface PendingTemp {
  chatId: number;
  messageId: number;
  timer: ReturnType<typeof setTimeout>;
}

let _pending: PendingTemp | null = null;

/**
 * Register a message as the current pending temp.
 * If a previous temp message exists it is deleted first.
 */
export function setPendingTemp(chatId: number, messageId: number, ttlSeconds = 300): void {
  // Replace any existing pending message
  if (_pending) {
    const prev = _pending;
    _pending = null;
    clearTimeout(prev.timer);
    void _delete(prev.chatId, prev.messageId);
  }

  const timer = setTimeout(() => {
    if (_pending?.messageId === messageId) {
      _pending = null;
    }
    void _delete(chatId, messageId);
  }, ttlSeconds * 1000);

  _pending = { chatId, messageId, timer };
}

/**
 * Schedule the pending temp message for deletion after a short grace period,
 * then clear the pending reference. The grace period lets the user still read
 * the status even when a real response arrives almost immediately.
 * Safe to call even when nothing is pending — it's a no-op.
 */
export function clearPendingTemp(): void {
  if (!_pending) return;
  const { chatId, messageId, timer } = _pending;
  _pending = null;
  clearTimeout(timer);
  setTimeout(() => void _delete(chatId, messageId), GRACE_SECONDS * 1000);
}

/** Returns true if a temp message is currently registered. */
export function hasPendingTemp(): boolean {
  return !!_pending;
}

async function _delete(chatId: number, messageId: number): Promise<void> {
  try {
    await getApi().deleteMessage(chatId, messageId);
  } catch {
    // Already deleted, expired, or bot lacks permission — silently ignore.
  }
}
