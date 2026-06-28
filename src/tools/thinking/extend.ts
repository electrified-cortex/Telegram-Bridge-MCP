/**
 * thinking/extend — Agent extension of the auto-started Thinking indicator.
 *
 * Allows the agent to take over the bridge-started Thinking bubble with:
 *   - `label`  — custom text shown as the draft body ("Analyzing the codebase…")
 *   - `phases` — array of strings cycled by the bridge on its own timer
 *   - `hold`   — total hold duration in seconds (bridge refreshes autonomously
 *                within each 30s window; agent doesn't ping)
 *
 * Token cost: open + close = 2 round-trips regardless of hold duration.
 * The keep-alive and phase cycling run bridge-side.
 *
 * thinking/close — explicitly dismiss the Thinking bubble.
 *
 * Both actions are no-ops if Thinking is not currently active, but they do
 * not return an error — this allows agents to call close speculatively.
 */

import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { extendThinking, closeThinking } from "../../thinking-state.js";

// ---------------------------------------------------------------------------
// thinking/extend
// ---------------------------------------------------------------------------

export const EXTEND_DESCRIPTION =
  "Extend or customise the auto-started Thinking indicator. " +
  "One call to take over — the bridge owns keep-alive and phase cycling. " +
  "Token cost: open+close = 2 round-trips regardless of hold duration. " +
  "label: custom text (shown as draft body). " +
  "phases: bridge cycles them on its own timer (one call, live-looking stages). " +
  "hold: total hold seconds (bridge refreshes autonomously; agent doesn't ping). " +
  "Thinking starts automatically on every actionable dequeue — call extend only to customise it. " +
  "Call action(type:'thinking/close') to dismiss it explicitly, or let the next send auto-close it. " +
  "See help(topic:'thinking') for lifecycle, constraints, and worked examples.";

export async function handleThinkingExtend(args: Record<string, unknown>) {
  const token = args.token as number | undefined;
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const label = typeof args.label === "string" ? args.label : undefined;
  const phases = Array.isArray(args.phases)
    ? (args.phases as unknown[]).filter((p): p is string => typeof p === "string")
    : undefined;
  const hold = typeof args.hold === "number" ? args.hold : undefined;

  const result = await extendThinking(sid, { label, phases, hold });
  if (!result.ok) return toError(result.reason ?? "thinking/extend failed");

  return toResult({
    ok: true,
    label: label ?? null,
    phases: phases ?? null,
    hold_seconds: hold ?? 30,
  });
}

export const EXTEND_INPUT_SCHEMA = {
  label: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Custom text shown as the draft body (e.g. 'Analyzing the codebase…'). " +
      "Omit to keep the generic Thinking bubble."
    ),
  phases: z
    .array(z.string().max(200))
    .optional()
    .describe(
      "Phase strings cycled by the bridge on its own timer — one call, live-looking stages. " +
      "Example: ['Reading files','Running tests','Drafting']. " +
      "Requires ≥ 2 phases to cycle; single-phase is treated as a label."
    ),
  hold: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .describe(
      "Total hold duration in seconds (1–600, default 30). " +
      "The bridge refreshes the draft autonomously within each 30s window. " +
      "Token cost is always 2 round-trips (open + close) regardless of hold duration."
    ),
  token: TOKEN_SCHEMA,
};

// ---------------------------------------------------------------------------
// thinking/close
// ---------------------------------------------------------------------------

export const CLOSE_DESCRIPTION =
  "Explicitly close the Thinking indicator. " +
  "Usually not needed — the next send auto-closes it. " +
  "Use only if you need to dismiss Thinking without immediately sending a response. " +
  "No-op if Thinking is not active.";

export function handleThinkingClose(args: Record<string, unknown>) {
  const token = args.token as number | undefined;
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const result = closeThinking(sid);
  return toResult({ ok: result.ok });
}

export const CLOSE_INPUT_SCHEMA = {
  token: TOKEN_SCHEMA,
};
