import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption, resolveChat } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";

export function register(server: McpServer) {
  server.tool(
    "send_photo",
    "Sends a photo to a chat by public URL or Telegram file_id. Supports captions and inline keyboards.",
    {
      photo: z
        .string()
        .describe("Public HTTPS URL of the image, or a Telegram file_id"),
      caption: z.string().optional().describe("Optional caption (up to 1024 chars)"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID — shows quoted message above the photo"),
    },
    async ({ photo, caption, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }
      const resolved = caption ? resolveParseMode(caption, parse_mode) : { text: undefined, parse_mode: undefined };
      try {
        cancelTyping();
        const msg = await getApi().sendPhoto(chatId, photo, {
          caption: resolved.text,
          parse_mode: resolved.parse_mode,
          disable_notification,
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
        });
        return toResult({
          message_id: msg.message_id,
          caption: msg.caption,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
