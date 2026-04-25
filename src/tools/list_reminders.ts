import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError } from "../telegram.js";
import { listReminders, computeReminderDisplayState } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function handleListReminders({ token }: { token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const now = Date.now();
  const reminders = listReminders().map(r => {
    const { state: displayState, until } = computeReminderDisplayState(r, now);
    const entry: Record<string, unknown> = {
      id: r.id,
      text: r.text,
      trigger: r.trigger,
      delay_seconds: r.delay_seconds,
      recurring: r.recurring,
      state: displayState,
    };
    if (displayState === "sleeping" && until !== undefined) {
      entry.until = new Date(until).toISOString();
    }
    if (r.state === "deferred" && displayState !== "disabled" && displayState !== "sleeping") {
      entry.fires_in_seconds = Math.max(
        0,
        Math.ceil((r.created_at + r.delay_seconds * 1000 - now) / 1000),
      );
    }
    return entry;
  });
  return toResult({ reminders });
}

export function register(server: McpServer) {
  server.registerTool(
    "list_reminders",
    {
      description:
        "List all scheduled reminders (deferred + active + startup) for this session. " +
        "Includes trigger (\"time\" or \"startup\"), state (deferred/active/startup/disabled/sleeping), " +
        "delay_seconds, recurring flag, fires_in_seconds for deferred reminders, and until (ISO-8601) for sleeping reminders.",
      inputSchema: {
        token: TOKEN_SCHEMA,
      },
    },
    handleListReminders,
  );
}
