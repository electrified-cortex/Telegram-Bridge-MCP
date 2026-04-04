import { validateSession } from "./session-manager.js";
import { decodeToken } from "./tools/identity-schema.js";
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
 * Pass the `token` integer from the tool args. Always required.
 * token = sid * 1_000_000 + pin  (from session_start)
 *
 * - Omitted → `SID_REQUIRED` error.
 * - Provided but invalid → `AUTH_FAILED` error.
 * - Valid → resolved SID (number) returned.
 *
 * Usage in a tool handler:
 * ```ts
 * const _sid = requireAuth(token);
 * if (typeof _sid !== "number") return toError(_sid);
 * ```
 */
export function requireAuth(
  token: number | undefined,
): number | TelegramError {
  if (token === undefined) {
    return {
      code: "SID_REQUIRED",
      message: "token is required. Pass the token returned by session_start. " +
        "token = sid * 1_000_000 + pin. Example: token: 1000123456",
    };
  }
  const { sid, pin } = decodeToken(token);
  if (!validateSession(sid, pin)) {
    return {
      code: "AUTH_FAILED",
      message: "Invalid token. Call session_start to get a fresh token.",
    };
  }
  _authHook?.(sid);
  return sid;
}
