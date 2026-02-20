import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "send_message",
    "Sends a text message to a Telegram chat. Supports HTML/MarkdownV2 formatting and any Bot API reply_markup (inline keyboards, reply keyboards, etc.).",
    {
      text: z.string().describe("Message text"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Text formatting mode"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send message silently"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID"),
    },
    async ({ text, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const textErr = validateText(text);
      if (textErr) return toError(textErr);
      try {
        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode,
          disable_notification,
          reply_parameters: reply_to_message_id
            ? { message_id: reply_to_message_id }
            : undefined,
        });
        return toResult({
          message_id: msg.message_id,
          text: msg.text,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
