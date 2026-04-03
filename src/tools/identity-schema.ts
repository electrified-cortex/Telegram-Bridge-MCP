import { z } from "zod";

/**
 * Human-readable description for the `token` parameter used in all tool schemas.
 */
export const TOKEN_PARAM_DESCRIPTION =
  "Session token from session_start (sid * 1_000_000 + pin). " +
  "Always required — pass your token on every tool call.";

/**
 * Zod schema for the `token` parameter.
 *
 * A single integer encoding both the session ID and PIN:
 *   token = sid * 1_000_000 + pin
 *
 * Use `decodeToken(token)` to extract `{ sid, pin }`.
 */
export const TOKEN_SCHEMA = z
  .number()
  .int()
  .positive()
  .describe(TOKEN_PARAM_DESCRIPTION);

/**
 * Decode a session token into its constituent sid and pin.
 *
 * @param token  Positive integer: sid * 1_000_000 + pin
 * @returns      { sid, pin }
 */
export function decodeToken(token: number): { sid: number; pin: number } {
  const pin = token % 1_000_000;
  const sid = Math.floor(token / 1_000_000);
  return { sid, pin };
}

// ---------------------------------------------------------------------------
// Legacy alias — kept so that any code that still imports IDENTITY_SCHEMA
// continues to compile while the migration is in progress.
// Remove once all callers are updated.
// ---------------------------------------------------------------------------
/** @deprecated Use TOKEN_SCHEMA instead */
export const IDENTITY_SCHEMA = TOKEN_SCHEMA;
