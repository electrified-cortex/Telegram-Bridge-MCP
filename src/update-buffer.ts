/**
 * Shared in-process update buffer.
 *
 * Problem solved: Telegram's getUpdates delivery is one-shot — once the offset
 * is advanced past an update it is gone from Telegram's servers. Any tool that
 * calls pollUntil() or getUpdates() and receives updates that don't match its
 * predicate would previously discard those updates silently.
 *
 * Solution: non-matching updates are pushed here instead of dropped. Every
 * subsequent polling call (wait_for_message, wait_for_callback_query,
 * get_updates) drains the buffer first before hitting the Telegram API, so
 * every update is seen by exactly one consumer and none are ever lost.
 */

import type { Update } from "grammy/types";

let _queue: Update[] = [];

/**
 * Add updates to the buffer (called by pollUntil for non-matching updates).
 */
export function enqueueUpdates(updates: Update[]): void {
  _queue.push(...updates);
}

/**
 * Find and remove the first buffered update that satisfies the predicate.
 * Returns the extracted value, or undefined if nothing matched.
 * Non-matching updates remain in the buffer untouched.
 */
export function dequeueMatch<T>(predicate: (u: Update) => T | undefined): T | undefined {
  for (let i = 0; i < _queue.length; i++) {
    const result = predicate(_queue[i]);
    if (result !== undefined) {
      _queue.splice(i, 1);
      return result;
    }
  }
  return undefined;
}

/**
 * Remove and return all buffered updates, optionally filtered.
 * Used by get_updates to drain buffered updates before polling Telegram.
 */
export function drainBuffer(filter?: (u: Update) => boolean): Update[] {
  if (!filter) {
    const all = _queue;
    _queue = [];
    return all;
  }
  const matched: Update[] = [];
  _queue = _queue.filter((u) => {
    if (filter(u)) {
      matched.push(u);
      return false;
    }
    return true;
  });
  return matched;
}

/** Returns a snapshot of the buffer without consuming it. */
export function peekBuffer(): Update[] {
  return [..._queue];
}

/** Returns the number of updates currently in the buffer. */
export function bufferSize(): number {
  return _queue.length;
}

/**
 * Remove and return up to `n` updates from the front of the buffer.
 * Remaining updates stay buffered for the next call.
 */
export function drainN(n: number): Update[] {
  const taken = _queue.splice(0, n);
  return taken;
}

/** For testing only — resets buffer state between tests. */
export function resetBufferForTest(): void {
  _queue = [];
}
