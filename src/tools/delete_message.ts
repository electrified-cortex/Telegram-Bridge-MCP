import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "delete_message",
    "Deletes a message. The bot can only delete messages it sent, or any message if it is an admin.",
    {
      chat_id: z.string().describe("Chat ID or @username"),
      message_id: z.number().int().describe("ID of the message to delete"),
    },
    async ({ chat_id, message_id }) => {
      try {
        const ok = await getApi().deleteMessage(chat_id, message_id);
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
