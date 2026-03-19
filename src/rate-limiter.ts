/**
 * Global Telegram API rate limiter.
 *
 * Two responsibilities:
 *
 * 1. **Rate-limit window**: When Telegram returns a 429, record the
 *    `retry_after` window. All subsequent outbound calls check this
 *    before hitting the network — callers get a fast RATE_LIMITED
 *    error instead of hammering Telegram and potentially extending the ban.
 *
 * 2. **Send debounce**: Enforce a minimum gap between outbound sends
 *    (default 1000 ms). Prevents bursts of tool calls from firing
 *    10+ messages in the same tick.
 *
 * Usage in outbound-proxy:
 *   await enforceRateLimit();   // throws TelegramError if limited
 *   await debounceSend();       // small wait if last send was recent
 *
 * Usage in animation-state:
 *   if (isRateLimited()) return; // skip frame, don't bother calling
 *   // ... call Telegram ...
 *   // on 429: recordRateLimit(retryAfterSeconds)
 */

import type { TelegramError } from "./telegram.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Epoch-ms timestamp until which all outbound sends are blocked. 0 = not limited. */
let _rateLimitUntil = 0;

/** Epoch-ms timestamp of the last completed outbound send. */
let _lastSendAt = 0;

/** Serialises concurrent debounceSend() callers so only one runs at a time. */
let _sendLock: Promise<void> = Promise.resolve();

/** Minimum gap (ms) between successive outbound sends (debounce floor). */
export const MIN_SEND_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Rate-limit window management
// ---------------------------------------------------------------------------

/**
 * Record a rate-limit window from a 429 response.
 * Extends the window if a longer retry_after arrives.
 * Defaults to 5 seconds when retryAfterSeconds is undefined.
 */
export function recordRateLimit(retryAfterSeconds: number | undefined): void {
  const until = Date.now() + (retryAfterSeconds ?? 5) * 1000;
  if (until > _rateLimitUntil) _rateLimitUntil = until;
}

/** True if the current time is inside a recorded rate-limit window. */
export function isRateLimited(): boolean {
  return Date.now() < _rateLimitUntil;
}

/**
 * Remaining seconds in the current rate-limit window.
 * Returns 0 if not currently limited.
 */
export function rateLimitRemainingSecs(): number {
  return Math.ceil(Math.max(0, _rateLimitUntil - Date.now()) / 1000);
}

/**
 * Check for an active rate-limit window and throw a TelegramError if limited.
 * Used by the outbound proxy so tool calls fail fast instead of hitting Telegram.
 */
export function enforceRateLimit(): void {
  if (!isRateLimited()) return;
  const retryAfter = rateLimitRemainingSecs();
  const error: TelegramError = {
    code: "RATE_LIMITED",
    message: `Rate limited by Telegram. Retry after ${retryAfter} seconds.`,
    retry_after: retryAfter,
  };
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TelegramError is a protocol object, not a JS Error
  throw error;
}

// ---------------------------------------------------------------------------
// Send debounce
// ---------------------------------------------------------------------------

/**
 * Enforce a minimum gap between outbound sends.
 * Awaits a short delay if the last send was too recent.
 * Call this immediately before every Telegram API send.
 */
export async function debounceSend(): Promise<void> {
  const ticket = _sendLock;
  let resolve!: () => void;
  _sendLock = new Promise<void>(r => { resolve = r; });
  await ticket;
  const gap = Date.now() - _lastSendAt;
  if (gap < MIN_SEND_INTERVAL_MS) {
    await new Promise<void>(r => setTimeout(r, MIN_SEND_INTERVAL_MS - gap));
  }
  _lastSendAt = Date.now();
  resolve();
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetRateLimiterForTest(): void {
  _rateLimitUntil = 0;
  _lastSendAt = 0;
  _sendLock = Promise.resolve();
}
