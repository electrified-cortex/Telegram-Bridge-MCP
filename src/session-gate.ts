import { validateSession } from "./session-manager.js";
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
  identity: [number, number] | undefined,
): number | TelegramError {
  if (!identity) {
    return {
      code: "SID_REQUIRED",
      message: "identity [sid, pin] is required. Pass the tuple returned by session_start.",
    };
  }
  const [sid, pin] = identity;
  if (!validateSession(sid, pin)) {
    return {
      code: "AUTH_FAILED",
      message: "Invalid session credentials. Check that sid and pin match those returned by session_start.",
    };
  }
  _authHook?.(sid);
  return sid;
}
