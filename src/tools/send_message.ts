import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "send_message",
    "Sends a text message to a Telegram chat. Supports HTML/MarkdownV2 formatting and any Bot API reply_markup (inline keyboards, reply keyboards, etc.).",
    {
      chat_id: z
        .string()
        .describe("Target chat ID (number as string) or @username"),
      text: z.string().describe("Message text"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Text formatting mode"),
      reply_markup: z
        .any()
        .optional()
        .describe(
          "Bot API reply_markup object: InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, or ForceReply"
        ),
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
    async ({ chat_id, text, parse_mode, reply_markup, disable_notification, reply_to_message_id }) => {
      const textErr = validateText(text);
      if (textErr) return toError(textErr);
      try {
        const msg = await getApi().sendMessage(chat_id, text, {
          parse_mode,
          reply_markup,
          disable_notification,
          reply_parameters: reply_to_message_id
            ? { message_id: reply_to_message_id }
            : undefined,
        });
        return toResult({
          message_id: msg.message_id,
          chat_id: msg.chat.id,
          date: msg.date,
          text: msg.text,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
