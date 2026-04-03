import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Deletes a message. The bot can delete its own messages anytime, " +
  "or other users' messages within 48 hours if admin.";

export function register(server: McpServer) {
  server.registerTool(
    "delete_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().min(1).describe("ID of the message to delete"),
              token: TOKEN_SCHEMA,
},
    },
    async ({ message_id, token}) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const ok = await getApi().deleteMessage(chatId, message_id);
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
