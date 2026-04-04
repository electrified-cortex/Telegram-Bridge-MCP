import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError } from "../telegram.js";
import { listReminders } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function register(server: McpServer) {
  server.registerTool(
    "list_reminders",
    {
      description:
        "List all scheduled reminders (deferred + active + startup) for this session. " +
        "Includes trigger (\"time\" or \"startup\"), state (deferred/active/startup), delay_seconds, recurring flag, and fires_in_seconds for deferred reminders.",
      inputSchema: {
        token: TOKEN_SCHEMA,
      },
    },
    ({ token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      const now = Date.now();
      const reminders = listReminders().map(r => {
        const entry: Record<string, unknown> = {
          id: r.id,
          text: r.text,
          trigger: r.trigger,
          delay_seconds: r.delay_seconds,
          recurring: r.recurring,
          state: r.state,
        };
        if (r.state === "deferred") {
          entry.fires_in_seconds = Math.max(
            0,
            Math.ceil((r.created_at + r.delay_seconds * 1000 - now) / 1000),
          );
        }
        return entry;
      });
      return toResult({ reminders });
    },
  );
}
