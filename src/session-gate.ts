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
 * Accepts `unknown` so that callers are not forced to pre-validate the identity
 * value before calling — this allows `requireAuth` to produce actionable error
 * messages even when the MCP schema accepts any value (e.g. `z.unknown()`).
 *
 * - Omitted / null → `SID_REQUIRED` error.
 * - String (e.g. `"[1, 852999]"`) → `INVALID_IDENTITY` error with guidance.
 * - Non-array → `SID_REQUIRED` error.
 * - Array with wrong length → `SID_REQUIRED` error.
 * - Valid `[sid, pin]` but wrong credentials → `AUTH_FAILED` error.
 * - Valid credentials → resolved SID (number) returned.
 *
 * Usage in a tool handler:
 * ```ts
 * const _sid = requireAuth(identity);
 * if (typeof _sid !== "number") return toError(_sid);
 * ```
 */
export function requireAuth(
  identity: unknown,
): number | TelegramError {
  // Detect the common mistake of passing identity as a JSON string.
  if (typeof identity === "string") {
    return {
      code: "INVALID_IDENTITY",
      message:
        `identity must be a JSON array [sid, pin], not a string — ` +
        `pass identity: ${identity} not identity: "${identity}"`,
    };
  }

  if (!identity) {
    return {
      code: "SID_REQUIRED",
      message: "identity [sid, pin] is required. Pass the tuple returned by session_start. Example: identity: [sid, pin]",
    };
  }

  if (!Array.isArray(identity)) {
    return {
      code: "SID_REQUIRED",
      message: `identity [sid, pin] is required — received ${typeof identity}, expected a 2-element [sid, pin] array. Example: identity: [sid, pin]`,
    };
  }

  const arr = identity as unknown[];
  if (arr.length !== 2) {
    const received = arr.length === 0
      ? "empty array"
      : arr.length === 1
      ? `[${arr[0]}] (missing pin)`
      : `${arr.length}-element array (expected exactly 2)`;
    return {
      code: "SID_REQUIRED",
      message: `identity [sid, pin] is required — received ${received}, expected a 2-element [sid, pin] array. Example: identity: [sid, pin]`,
    };
  }

  const [sid, pin] = arr as [number, number];
  if (!validateSession(sid, pin)) {
    let sessionExists = false;
    try { sessionExists = getSession(sid) !== undefined; } catch (e) {
      // Absorb TypeError (getSession undefined in mock env) and test-framework errors
      // about missing mock exports. Any other error is a real runtime issue.
      if (!(e instanceof TypeError) && !(e instanceof Error && /getSession/.test(e.message))) {
        throw e;
      }
    }
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
