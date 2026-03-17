import { activeSessionCount, getActiveSession } from "./session-manager.js";
import type { TelegramError } from "./telegram.js";

/**
 * The `sid` Zod schema fragment used by every gated tool.
 * Import this constant and spread it into `inputSchema` so the description
 * stays consistent and the schema never drifts.
 */
export const SID_SCHEMA_FIELD = {
  description:
    "Session ID returned by session_start. " +
    "Required when multiple sessions share the same server process.",
} as const;

/**
 * Resolves the session ID for a tool call and enforces the multi-session
 * SID requirement.
 *
 * - If `sid` is provided: returns it directly.
 * - If only one (or zero) sessions are active: falls back to
 *   `getActiveSession()` (single-agent backward-compat).
 * - If multiple sessions are active and `sid` is omitted: returns a
 *   `TelegramError` with code `SID_REQUIRED`.
 *
 * Usage in a tool handler:
 * ```ts
 * const _sid = requireSid(sid);
 * if (typeof _sid !== "number") return toError(_sid);
 * ```
 */
export function requireSid(sid: number | undefined): number | TelegramError {
  if (sid !== undefined) return sid;
  if (activeSessionCount() <= 1) return getActiveSession();
  return {
    code: "SID_REQUIRED",
    message:
      `Multiple sessions are active (${activeSessionCount()}). ` +
      `Pass sid (from session_start) to identify your session.`,
  };
}
