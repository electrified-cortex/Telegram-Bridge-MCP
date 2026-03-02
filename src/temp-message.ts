/**
 * Temporary message tracker.
 *
 * A temp message is a short status like "Thinking…" that should vanish the
 * moment the agent sends a real response. Two things can delete it:
 *
 *   1. Any outbound tool calls clearPendingTemp() before sending — exact timing,
 *      the placeholder disappears right before the real content arrives.
 *   2. The TTL timer fires — safety net if the agent goes silent.
 *
 * Storing in-process is intentional: we accept the tradeoff that a server
 * restart orphans the message. These are ephemeral "Thinking…" placeholders,
 * not important content, so consistency guarantees would be overkill.
 */

import { getApi } from "./telegram.js";

interface PendingTemp {
  chatId: string;
  messageId: number;
  timer: ReturnType<typeof setTimeout>;
}

let _pending: PendingTemp | null = null;

/**
 * Register a message as the current pending temp.
 * If a previous temp message exists it is deleted first.
 */
export function setPendingTemp(chatId: string, messageId: number, ttlSeconds = 30): void {
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
 * Delete the pending temp message (if any) and cancel its timer.
 * Safe to call even when nothing is pending — it's a no-op.
 * Awaiting this before sending ensures the placeholder is gone first.
 */
export async function clearPendingTemp(): Promise<void> {
  if (!_pending) return;
  const { chatId, messageId, timer } = _pending;
  _pending = null;
  clearTimeout(timer);
  await _delete(chatId, messageId);
}

/** Returns true if a temp message is currently registered. */
export function hasPendingTemp(): boolean {
  return _pending !== null;
}

async function _delete(chatId: string, messageId: number): Promise<void> {
  try {
    await getApi().deleteMessage(chatId, messageId);
  } catch {
    // Already deleted, expired, or bot lacks permission — silently ignore.
  }
}
