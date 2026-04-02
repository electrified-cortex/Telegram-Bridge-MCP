import { validateSession, getSession } from "./session-manager.js";
import type { TelegramError } from "./telegram.js";

// ── Auth hook ──────────────────────────────────────────────

/** Optional side-effect triggered on every successful auth. */
let _authHook: ((sid: number) => void) | undefined;

/** Register a callback invoked after every successful requireAuth(). */
export function setAuthHook(fn: (sid: number) => void): void {
  _authHook = fn;
}

/**
 * Resolves and authenticates the session for a tool call.
 *
 * Pass the `identity` tuple `[sid, pin]` from the tool args. Always required.
 *
 * - Omitted → `SID_REQUIRED` error.
 * - Provided but invalid → `AUTH_FAILED` error.
 * - Valid → resolved SID (number) returned.
 *
 * Usage in a tool handler:
 * ```ts
 * const _sid = requireAuth(identity);
 * if (typeof _sid !== "number") return toError(_sid);
 * ```
 */
export function requireAuth(
  identity: readonly number[] | undefined,
): number | TelegramError {
  if (!identity) {
    return {
      code: "SID_REQUIRED",
      message: "identity [sid, pin] is required. Pass the tuple returned by session_start. Example: identity: [sid, pin]",
    };
  }
  if (identity.length < 2) {
    const received = identity.length === 0
      ? "empty array"
      : `[${identity[0]}] (missing pin)`;
    return {
      code: "SID_REQUIRED",
      message: `identity [sid, pin] is required — received ${received}, expected a 2-element array. Example: identity: [sid, pin]`,
    };
  }
  const [sid, pin] = identity;
  if (!validateSession(sid, pin)) {
    let sessionExists = false;
    try { sessionExists = getSession(sid) !== undefined; } catch { /* not available in mock env */ }
    return {
      code: "AUTH_FAILED",
      message: sessionExists
        ? `PIN mismatch for SID ${sid}. Check that pin matches the value returned by session_start.`
        : `Session SID ${sid} not found — it may have expired or been closed. Call session_start to get a new [sid, pin] tuple.`,
    };
  }
  _authHook?.(sid);
  return sid;
}
