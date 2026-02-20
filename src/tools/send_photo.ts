import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "send_photo",
    "Sends a photo to a chat by public URL or Telegram file_id. Supports captions and inline keyboards.",
    {
      chat_id: z
        .string()
        .describe("Target chat ID (number as string) or @username"),
      photo: z
        .string()
        .describe("Public HTTPS URL of the image, or a Telegram file_id"),
      caption: z.string().optional().describe("Optional caption (up to 1024 chars)"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Caption formatting mode"),
      reply_markup: z
        .any()
        .optional()
        .describe("InlineKeyboardMarkup or ReplyKeyboardMarkup"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently"),
    },
    async ({ chat_id, photo, caption, parse_mode, reply_markup, disable_notification }) => {
      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }
      try {
        const msg = await getApi().sendPhoto(chat_id, photo, {
          caption,
          parse_mode,
          reply_markup,
          disable_notification,
        });
        return toResult({
          message_id: msg.message_id,
          chat_id: msg.chat.id,
          date: msg.date,
          caption: msg.caption,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
