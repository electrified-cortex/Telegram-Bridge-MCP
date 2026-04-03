import { z } from "zod";

/**
 * Zod schema for the identity [sid, pin] parameter.
 *
 * Uses `z.unknown()` so that the MCP framework never rejects the call at
 * schema-validation time — even when a caller mistakenly passes identity as a
 * JSON string (e.g. `"[1, 852999]"` instead of `[1, 852999]`).  All semantic
 * validation (type checking, length, auth) is done inside `requireAuth` in
 * `session-gate.ts`, which returns a structured error message that the caller
 * can act on.
 *
 * Previous schema (`z.array(z.number().int())`) caused the MCP SDK to reject
 * string inputs with a generic -32602 error BEFORE the handler ran, making the
 * error message unactionable.
 *
 * NOTE: z.unknown() emits no JSON Schema constraints, which is intentional —
 * the description text and runtime validation provide the contract.
 */
export const IDENTITY_SCHEMA = z
  .unknown()
  .optional()
  .describe(
    "Identity tuple [sid, pin] from session_start. " +
    "Always required — pass your [sid, pin] on every tool call. " +
    "Must be a JSON array of two integers, e.g. identity: [sid, pin].",
  );
