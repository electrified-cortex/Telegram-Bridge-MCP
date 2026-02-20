import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "edit_message_text",
    "Edits the text of a previously sent message. Useful for updating inline keyboards or changing content after a user interacts with buttons.",
    {
      message_id: z.number().int().describe("ID of the message to edit"),
      text: z.string().describe("New text content"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .optional()
        .describe("Text formatting mode"),
    },
    async ({ message_id, text, parse_mode }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const result = await getApi().editMessageText(
          chatId,
          message_id,
          text,
          { parse_mode },
        );
        const editedId = typeof result === "boolean" ? message_id : result.message_id;
        return toResult({ message_id: editedId });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
