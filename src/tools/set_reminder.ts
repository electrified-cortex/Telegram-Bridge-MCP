import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { addReminder, MAX_REMINDERS_PER_SESSION, reminderContentHash } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Schedule a reminder that fires as a synthetic event after the message queue is idle for 60 seconds. " +
  "Immediate reminders (no delay) enter the active queue and fire on the next 60s idle window. " +
  "Deferred reminders (delay_seconds > 0) enter a waiting queue and auto-promote to active after the delay elapses. " +
  "One-shot reminders are deleted after firing; recurring reminders re-arm automatically. " +
  `Maximum ${MAX_REMINDERS_PER_SESSION} reminders per session.`;

export function register(server: McpServer) {
  server.registerTool(
    "set_reminder",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().max(500).describe("Reminder message surfaced in the synthetic event."),
        delay_seconds: z
          .number()
          .int()
          .min(0)
          .max(86400)
          .optional()
          .describe("Seconds to wait before the reminder becomes active (default: 0 = immediately active)."),
        recurring: z
          .boolean()
          .optional()
          .describe("Re-arm after firing? (default: false). Recurring reminders re-enter their delay queue after each delivery."),
        id: z
          .string()
          .max(128)
          .optional()
          .describe("Optional ID for cancellation via cancel_reminder. Auto-generated (UUID) if omitted."),
        token: TOKEN_SCHEMA,
      },
    },
    ({ text, delay_seconds = 0, recurring = false, id, token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      const reminderId = id ?? reminderContentHash(text, recurring);

      let reminder;
      try {
        reminder = addReminder({ id: reminderId, text, delay_seconds, recurring });
      } catch (err) {
        return toError({
          code: "LIMIT_EXCEEDED" as const,
          message: (err as Error).message,
        });
      }

      const result: Record<string, unknown> = {
        id: reminder.id,
        text: reminder.text,
        delay_seconds: reminder.delay_seconds,
        recurring: reminder.recurring,
        state: reminder.state,
      };
      if (reminder.state === "deferred") {
        result.fires_in_seconds = reminder.delay_seconds;
      }
      return toResult(result);
    },
  );
}
