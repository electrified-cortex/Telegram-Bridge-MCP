import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "edit_message_text",
    "Edits the text of a previously sent message. Useful for updating inline keyboards or changing content after a user interacts with buttons.",
    {
      chat_id: z.string().describe("Chat ID of the message to edit"),
      message_id: z.number().int().describe("ID of the message to edit"),
      text: z.string().describe("New text content"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Text formatting mode"),
      reply_markup: z
        .any()
        .optional()
        .describe("Updated InlineKeyboardMarkup, or omit to remove keyboard"),
    },
    async ({ chat_id, message_id, text, parse_mode, reply_markup }) => {
      try {
        const result = await getApi().editMessageText(
          chat_id,
          message_id,
          text,
          { parse_mode, reply_markup },
        );
        return toResult(result);
      } catch (err) {
        return toError(err);
      }
    }
  );
}
