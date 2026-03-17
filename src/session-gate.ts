import { activeSessionCount, getActiveSession, validateSession } from "./session-manager.js";
import type { TelegramError } from "./telegram.js";

/**
 * Resolves and authenticates the session for a tool call.
 *
 * Pass the `identity` tuple `[sid, pin]` from the tool args.
 *
 * - **Single-session mode** (`activeSessionCount() <= 1`): `identity` may be
 *   omitted. Falls back to `getActiveSession()` for backward compat.
 * - **Multi-session mode** (`activeSessionCount() > 1`): `identity` is
 *   required.
 *   - Omitted → `SID_REQUIRED` error.
 *   - Provided but invalid → `AUTH_FAILED` error.
 *   - Valid → resolved SID (number) returned.
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
  if (activeSessionCount() <= 1) return getActiveSession();
  if (!identity) {
    return {
      code: "SID_REQUIRED",
      message:
        `Multiple sessions are active (${activeSessionCount()}). ` +
        `Pass identity ([sid, pin] from session_start) to identify your session.`,
    };
  }
  const [sid, pin] = identity;
  if (!validateSession(sid, pin)) {
    return {
      code: "AUTH_FAILED",
      message: "Invalid session credentials. Check that sid and pin match those returned by session_start.",
    };
  }
  return sid;
}
