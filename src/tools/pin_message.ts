import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

const DESCRIPTION =
  "Pins or unpins a message in a chat. Requires the bot to have " +
  "appropriate admin rights. Pass unpin: true to unpin instead of pin. " +
  "Omit message_id with unpin: true to unpin the most recently pinned " +
  "message.";

export function register(server: McpServer) {
  server.registerTool(
    "pin_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z
        .number()
        .int()
        .optional()
        .describe("ID of the message to pin/unpin. Required for pinning. For unpinning, omit to unpin the most recently pinned message."),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Pin without notifying members"),
      unpin: z
        .boolean()
        .optional()
        .describe("If true, unpin instead of pin"),
      },
    },
    async ({ message_id, disable_notification, unpin }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        if (unpin) {
          const ok = await getApi().unpinChatMessage(chatId, message_id);
          return toResult({ ok, unpinned: true });
        }
        if (message_id === undefined) {
          return toError({ code: "MISSING_MESSAGE_ID" as const, message: "message_id is required when pinning" });
        }
        const ok = await getApi().pinChatMessage(chatId, message_id, {
          disable_notification,
        });
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
