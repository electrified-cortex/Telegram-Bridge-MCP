import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";

export function register(server: McpServer) {
  server.tool(
    "edit_message_text",
    "Edits the text of a previously sent message. Supports Markdown auto-conversion (default), MarkdownV2, and HTML. Can optionally update or clear the inline keyboard.",
    {
      message_id: z.number().int().describe("ID of the message to edit"),
      text: z.string().describe("New text content"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
      reply_markup: z
        .object({
          inline_keyboard: z
            .array(
              z.array(
                z.object({
                  text: z.string(),
                  callback_data: z.string().optional(),
                  url: z.string().optional(),
                })
              )
            )
            .describe("Array of button rows"),
        })
        .optional()
        .describe("New inline keyboard. Pass { inline_keyboard: [] } to remove buttons."),
    },
    async ({ message_id, text, parse_mode, reply_markup }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const resolved = resolveParseMode(text, parse_mode);
      const textErr = validateText(resolved.text);
      if (textErr) return toError(textErr);
      cancelTyping();
      try {
        const result = await getApi().editMessageText(
          chatId,
          message_id,
          resolved.text,
          { parse_mode: resolved.parse_mode, reply_markup: reply_markup as any },
        );
        const editedId = typeof result === "boolean" ? message_id : result.message_id;
        return toResult({ message_id: editedId });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
