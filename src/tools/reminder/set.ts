import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { addReminder, MAX_REMINDERS_PER_SESSION, reminderContentHash } from "../../reminder-state.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";

const DESCRIPTION =
  "Schedule a reminder that fires as a synthetic event in dequeue. " +
  "trigger: \"time\" (default) — fires after 60s of queue idle (delay_seconds defers activation). " +
  "trigger: \"startup\" — fires on the next session_start (delay_seconds ignored). " +
  "trigger: \"last_sent\" — fires delay_seconds after the most recent confirmed outbound send; re-arms on next send. " +
  "trigger: \"last_received\" — fires delay_seconds after the most recent qualifying inbound; mode controls which inbound qualifies. " +
  "Startup reminders fire on every session_start when recurring: true; one-shot startup reminders fire once then are deleted. " +
  "One-shot time reminders are deleted after firing; recurring time reminders re-arm automatically. " +
  `Maximum ${MAX_REMINDERS_PER_SESSION} reminders per session.`;

export function handleSetReminder({ text, trigger = "time", delay_seconds = 0, recurring = false, id, mode, token }: {
  text: string;
  trigger?: "time" | "startup" | "last_sent" | "last_received";
  delay_seconds?: number;
  recurring?: boolean;
  id?: string;
  mode?: "all" | "operator";
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const reminderId = id ?? reminderContentHash(text, recurring, trigger, trigger === "last_received" ? mode : undefined);

  let reminder;
  try {
    reminder = addReminder({ id: reminderId, text, delay_seconds, recurring, trigger, mode });
  } catch (err) {
    return toError({
      code: "LIMIT_EXCEEDED" as const,
      message: `${(err as Error).message}. Cancel an existing reminder with cancel_reminder before adding more.`,
    });
  }

  const result: Record<string, unknown> = {
    id: reminder.id,
    text: reminder.text,
    delay_seconds: reminder.delay_seconds,
    recurring: reminder.recurring,
    trigger: reminder.trigger,
    state: reminder.state,
  };
  if (reminder.trigger === "last_received") result.mode = reminder.mode ?? "all";
  if (reminder.state === "deferred") {
    result.fires_in_seconds = reminder.delay_seconds;
  }
  return toResult(result);
}

export function register(server: McpServer) {
  server.registerTool(
    "set_reminder",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().max(500).describe("Reminder message surfaced in the synthetic event."),
        trigger: z
          .enum(["time", "startup", "last_sent", "last_received"])
          .default("time")
          .describe(
            "When to fire: \"time\" (default) fires after delay_seconds + 60s idle; " +
            "\"startup\" fires automatically on session_start / reconnect; " +
            "\"last_sent\" fires delay_seconds after the most recent confirmed outbound send, re-arms on next send; " +
            "\"last_received\" fires delay_seconds after the most recent qualifying inbound, re-arms on next inbound.",
          ),
        delay_seconds: z
          .number()
          .int()
          .min(0)
          .max(86400)
          .optional()
          .describe("Seconds to wait before the reminder becomes active (default: 0 = immediately active). Ignored for trigger: \"startup\"."),
        recurring: z
          .boolean()
          .optional()
          .describe("Re-arm after firing? (default: false). Recurring reminders re-enter their delay queue (time) or persist (startup/last_sent/last_received) after each delivery."),
        id: z
          .string()
          .max(128)
          .optional()
          .describe("Optional ID for cancellation via cancel_reminder. Auto-generated (UUID) if omitted."),
        mode: z
          .enum(["all", "operator"])
          .optional()
          .describe("last_received only: which inbound events reset the clock. \"all\" (default) = operator messages + inter-session DMs; \"operator\" = operator messages only."),
        token: TOKEN_SCHEMA,
      },
    },
    handleSetReminder,
  );
}
