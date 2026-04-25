import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { enableReminder } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function handleEnableReminder({ id, token }: { id: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const reminder = enableReminder(id);
  if (!reminder) {
    return toError({
      code: "NOT_FOUND" as const,
      message: `No reminder with id="${id}" found for this session. Call action(type: 'reminder/list') to see reminder IDs.`,
    });
  }
  return toResult({ enabled: true, id: reminder.id, state: reminder.state });
}

export function register(server: McpServer) {
  server.registerTool(
    "enable_reminder",
    {
      description:
        "Re-activate a reminder that was previously disabled via action(type: 'reminder/disable'). " +
        "Idempotent — calling on an already-active reminder is safe. " +
        "Does not affect sleep state; a sleeping-but-enabled reminder will resume firing when its sleep expires.",
      inputSchema: {
        id: z.string().describe("Reminder ID to enable (from action(type: 'reminder/list'))."),
        token: TOKEN_SCHEMA,
      },
    },
    handleEnableReminder,
  );
}
