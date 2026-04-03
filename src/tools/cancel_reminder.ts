import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { cancelReminder } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function register(server: McpServer) {
  server.registerTool(
    "cancel_reminder",
    {
      description: "Cancel a scheduled reminder by ID. Returns an error if the ID is not found.",
      inputSchema: {
        id: z.string().describe("Reminder ID to cancel (from set_reminder or list_reminders)."),
        token: TOKEN_SCHEMA,
      },
    },
    ({ id, token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      const cancelled = cancelReminder(id);
      if (!cancelled) {
        return toError({
          code: "NOT_FOUND" as const,
          message: `No reminder with id="${id}" found for this session.`,
        });
      }
      return toResult({ cancelled: true, id });
    },
  );
}
