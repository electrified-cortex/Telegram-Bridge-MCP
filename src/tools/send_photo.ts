import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption, resolveChat } from "../telegram.js";

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
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Caption formatting mode"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently"),
    },
    async ({ photo, caption, parse_mode, disable_notification }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }
      try {
        const msg = await getApi().sendPhoto(chatId, photo, {
          caption,
          parse_mode,
          disable_notification,
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
