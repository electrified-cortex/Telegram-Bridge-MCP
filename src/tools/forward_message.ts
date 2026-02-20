import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "forward_message",
    "Forwards a message from one chat to another.",
    {
      chat_id: z.string().describe("Destination chat ID or @username"),
      from_chat_id: z.string().describe("Source chat ID or @username"),
      message_id: z.number().int().describe("ID of the message to forward"),
      disable_notification: z.boolean().optional().describe("Forward silently"),
    },
    async ({ chat_id, from_chat_id, message_id, disable_notification }) => {
      try {
        const msg = await getApi().forwardMessage(chat_id, from_chat_id, message_id, {
          disable_notification,
        });
        return toResult({
          message_id: msg.message_id,
          chat_id: msg.chat.id,
          date: msg.date,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
