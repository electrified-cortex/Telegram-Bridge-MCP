/**
 * Temporary message tracker — per-session.
 *
 * A temp message is a short status like "Thinking…" that should vanish
 * shortly after the agent sends a real response. Two things can delete it:
 *
 *   1. Any outbound tool calls clearPendingTemp() — schedules deletion after
 *      a short grace period so the user can still read it.
 *   2. The TTL timer fires — safety net if the agent goes silent.
 *
 * State is keyed by SID so sessions don't clobber each other's placeholders.
 * Storing in-process is intentional: we accept the tradeoff that a server
 * restart orphans the message. These are ephemeral "Thinking…" placeholders,
 * not important content, so consistency guarantees would be overkill.
 */

import { getApi } from "./telegram.js";
import { getCallerSid } from "./session-context.js";

/** Seconds the temp message lingers after clearPendingTemp() so the user can still read it. */
const GRACE_SECONDS = 10;

interface PendingTemp {
  chatId: number;
  messageId: number;
  timer: ReturnType<typeof setTimeout>;
}

const _pending = new Map<number, PendingTemp>();

/**
 * Register a message as the current pending temp for the calling session.
 * If a previous temp message exists for this session it is deleted first.
 */
export function setPendingTemp(chatId: number, messageId: number, ttlSeconds = 300): void {
  const sid = getCallerSid();
  // Replace any existing pending message for this session
  const prev = _pending.get(sid);
  if (prev) {
    _pending.delete(sid);
    clearTimeout(prev.timer);
    void _delete(prev.chatId, prev.messageId);
  }

  const timer = setTimeout(() => {
    const current = _pending.get(sid);
    if (current?.messageId === messageId) {
      _pending.delete(sid);
    }
    void _delete(chatId, messageId);
  }, ttlSeconds * 1000);

  _pending.set(sid, { chatId, messageId, timer });
}

/**
 * Schedule the pending temp message for deletion after a short grace period,
 * then clear the pending reference. The grace period lets the user still read
 * the status even when a real response arrives almost immediately.
 * Safe to call even when nothing is pending — it's a no-op.
 */
export function clearPendingTemp(): void {
  const sid = getCallerSid();
  const p = _pending.get(sid);
  if (!p) return;
  const { chatId, messageId, timer } = p;
  _pending.delete(sid);
  clearTimeout(timer);
  setTimeout(() => void _delete(chatId, messageId), GRACE_SECONDS * 1000);
}

/** Returns true if a temp message is currently registered for the calling session. */
export function hasPendingTemp(): boolean {
  return _pending.has(getCallerSid());
}

async function _delete(chatId: number, messageId: number): Promise<void> {
  try {
    await getApi().deleteMessage(chatId, messageId);
  } catch {
    // Already deleted, expired, or bot lacks permission — silently ignore.
  }
}
