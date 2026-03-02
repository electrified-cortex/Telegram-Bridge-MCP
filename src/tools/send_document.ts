import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InputFile } from "grammy";
import { existsSync } from "fs";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption, resolveChat, callApi } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { cancelTyping, showTyping } from "../typing-state.js";
import { clearPendingTemp } from "../temp-message.js";

export function register(server: McpServer) {
  server.tool(
    "send_document",
    "Sends a file (document) to the Telegram chat. Accepts a local file path, a public HTTPS URL, or a Telegram file_id. Use this to send PDFs, Excel files, ZIPs, text files, or any other file type. For photos/images, use send_photo instead.",
    {
      document: z
        .string()
        .describe(
          "Local absolute file path (e.g. /tmp/report.xlsx), a public HTTPS URL, or a Telegram file_id"
        ),
      caption: z
        .string()
        .optional()
        .describe("Optional caption (up to 1024 chars)"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe(
          "Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"
        ),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID"),
    },
    async ({ document, caption, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }

      const resolved = caption
        ? resolveParseMode(caption, parse_mode)
        : { text: undefined, parse_mode: undefined };

      // Resolve the document source: local path, URL, or file_id
      let docSource: string | InputFile;
      if (document.startsWith("http://") || document.startsWith("https://")) {
        // URL — pass directly
        docSource = document;
      } else if (existsSync(document)) {
        // Local file path — wrap in InputFile
        docSource = new InputFile(document);
      } else {
        // Assume Telegram file_id
        docSource = document;
      }

      await clearPendingTemp();
      try {
        await showTyping(60, "upload_document");
        const msg = await callApi(() => getApi().sendDocument(chatId, docSource, {
          caption: resolved.text,
          parse_mode: resolved.parse_mode,
          disable_notification,
          reply_parameters: reply_to_message_id
            ? { message_id: reply_to_message_id }
            : undefined,
        }));
        cancelTyping();
        return toResult({
          message_id: msg.message_id,
          file_id: msg.document?.file_id,
          file_name: msg.document?.file_name,
          mime_type: msg.document?.mime_type,
          file_size: msg.document?.file_size,
        });
      } catch (err) {
        cancelTyping();
        return toError(err);
      }
    }
  );
}
