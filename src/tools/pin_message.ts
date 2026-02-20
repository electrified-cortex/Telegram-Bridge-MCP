import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "pin_message",
    "Pins a message in a chat. Requires the bot to have appropriate admin rights.",
    {
      chat_id: z.string().describe("Chat ID or @username"),
      message_id: z.number().int().describe("ID of the message to pin"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Pin without notifying members"),
    },
    async ({ chat_id, message_id, disable_notification }) => {
      try {
        const ok = await getApi().pinChatMessage(chat_id, message_id, {
          disable_notification,
        });
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
