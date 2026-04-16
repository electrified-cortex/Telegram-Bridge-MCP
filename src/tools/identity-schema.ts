import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { DIGITS_ONLY } from "../utils/patterns.js";

/**
 * Human-readable description for the `token` parameter used in all tool schemas.
 */
export const TOKEN_PARAM_DESCRIPTION =
  "Session token from action(type: 'session/start') (sid * 1_000_000 + pin). " +
  "Required for all paths except session/start, session/reconnect, and unauthenticated `session/list` probe — pass your token on every other tool call.";

// ---------------------------------------------------------------------------
// Token string-coercion hint
// ---------------------------------------------------------------------------

/**
 * Per-request AsyncLocalStorage for the token string-coercion hint.
 *
 * Stores `true` when the current request's TOKEN_SCHEMA parse received a
 * numeric string instead of an integer. Using AsyncLocalStorage ensures that
 * concurrent HTTP requests cannot observe each other's hint state — each
 * tool-handler invocation runs inside its own async context (established by
 * the `runInTokenHintContext` wrapper in server.ts).
 *
 * Falls back gracefully to `false` outside any async context (e.g. tests
 * that call TOKEN_SCHEMA.safeParse directly without a session wrapper).
 */

const _tokenStringHintAls = new AsyncLocalStorage<{ wasString: boolean }>();

/**
 * Returns a hint string if the current request's token parse coerced a string
 * to an integer, then resets the hint. Returns undefined if the token was
 * already an integer.
 *
 * Call this in tool handlers that want to nudge the LLM toward passing the
 * correct type. Currently used by `dequeue`.
 */
/** User-facing hint emitted when a token is passed as a numeric string instead of an integer. */
export const TOKEN_STRING_HINT = "token was passed as a string — use a plain integer for better performance";

export function consumeTokenStringHint(): string | undefined {
  const store = _tokenStringHintAls.getStore();
  if (store?.wasString) {
    store.wasString = false;
    return TOKEN_STRING_HINT;
  }
  return undefined;
}

/**
 * Zod schema for the `token` parameter.
 *
 * A single integer encoding both the session ID and PIN:
 *   token = sid * 1_000_000 + pin
 *
 * Accepts both plain integers and numeric strings (e.g. "10982170") — the
 * latter are coerced to integer via `z.preprocess`. The JSON Schema output
 * still produces `type: "integer"` so OpenAI-style validators stay happy.
 *
 * Use `decodeToken(token)` to extract `{ sid, pin }`.
 */
export const TOKEN_SCHEMA = z
  .preprocess(
    (v) => {
      const wasString = typeof v === "string" && DIGITS_ONLY.test(v);
      const store = _tokenStringHintAls.getStore();
      if (store !== undefined) {
        // Running inside a tool-handler async context — store hint there.
        store.wasString = wasString;
      }
      return wasString ? parseInt(v, 10) : v;
    },
    z.number().int().positive(),
  )
  .describe(TOKEN_PARAM_DESCRIPTION);

/**
 * Execute `fn` within a fresh token-hint async context. Each tool-handler
 * invocation must be wrapped with this (or the combined session+hint wrapper)
 * so that concurrent requests track their hint state independently.
 *
 * In practice, server.ts wraps every tool call via `runInSessionContext`.
 * Call `runInTokenHintContext` around the same boundary so the preprocess
 * callback and the handler share one mutable hint store.
 */
export function runInTokenHintContext<T>(fn: () => T): T {
  return _tokenStringHintAls.run({ wasString: false }, fn);
}

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
