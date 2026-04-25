import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { disableReminder } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function handleDisableReminder({ id, token }: { id: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const reminder = disableReminder(id);
  if (!reminder) {
    return toError({
      code: "NOT_FOUND" as const,
      message: `No reminder with id="${id}" found for this session. Call action(type: 'reminder/list') to see active reminder IDs.`,
    });
  }
  return toResult({ disabled: true, id: reminder.id });
}

export function register(server: McpServer) {
  server.registerTool(
    "disable_reminder",
    {
      description:
        "Pause a reminder without deleting it. The reminder keeps its full config " +
        "(text, interval, recurring) but stops firing until re-enabled. " +
        "Idempotent. Disabled state survives session restart and profile/save. " +
        "To re-activate, use action(type: 'reminder/enable', id: '...').",
      inputSchema: {
        id: z.string().describe("Reminder ID to disable (from action(type: 'reminder/list'))."),
        token: TOKEN_SCHEMA,
      },
    },
    handleDisableReminder,
  );
}
