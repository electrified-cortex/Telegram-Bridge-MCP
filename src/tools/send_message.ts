import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";

export function register(server: McpServer) {
  server.tool(
    "send_message",
    "Sends a text message to a Telegram chat. Default parse_mode is Markdown — write standard Markdown (*bold*, _italic_, `code`, **bold**, [links](url)) and it is auto-converted so no manual escaping is needed. Use MarkdownV2 for full control, or HTML for punctuation-heavy content.",
    {
      text: z.string().describe("Message text"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw Telegram V2 (manual escaping required); HTML = HTML tags"),
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
      const finalText = parse_mode === "Markdown" ? markdownToV2(text) : text;
      const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;
      const textErr = validateText(finalText);
      if (textErr) return toError(textErr);
      try {
        const msg = await getApi().sendMessage(chatId, finalText, {
          parse_mode: finalMode,
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

