import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "forward_message",
    "Forwards a message from one chat to another.",
    {
      from_chat_id: z.string().describe("Source chat ID or @username"),
      message_id: z.number().int().describe("ID of the message to forward"),
      disable_notification: z.boolean().optional().describe("Forward silently"),
    },
    async ({ from_chat_id, message_id, disable_notification }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const msg = await getApi().forwardMessage(chatId, from_chat_id, message_id, {
          disable_notification,
        });
        return toResult({
          message_id: msg.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
