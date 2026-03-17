import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { requireAuth } from "../session-gate.js";

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
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    async ({ message_id, identity}) => {
      const _sid = requireAuth(identity);
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
