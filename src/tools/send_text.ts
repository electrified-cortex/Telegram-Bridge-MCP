import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat, splitMessage, callApi } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";

const DESCRIPTION =
  "Sends a text message to the Telegram chat. Default parse_mode is Markdown — " +
  "write standard Markdown (*bold*, _italic_, `code`, [links](url)) and it is " +
  "auto-converted. Messages longer than 4096 characters are automatically split. " +
  "For structured status with severity styling, use notify instead. " +
  "For voice/TTS, use send_text_as_voice instead. " +
  "Ensure session_start has been called.";

export function register(server: McpServer) {
  server.registerTool(
    "send_text",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z
          .string()
          .describe("Message text. Automatically split if longer than 4096 characters."),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Markdown = auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send message silently"),
        reply_to_message_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
      },
    },
    async ({ text, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const textWithTopic = applyTopicToText(text, parse_mode);
      const finalText = parse_mode === "Markdown" ? markdownToV2(textWithTopic) : textWithTopic;
      const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;

      if (!finalText || finalText.trim().length === 0) {
        return toError({ code: "EMPTY_MESSAGE" as const, message: "Message text must not be empty." });
      }

      const chunks = splitMessage(finalText);

      try {
        const message_ids: number[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const textErr = validateText(chunk);
          if (textErr) return toError(textErr);

          const msg = await callApi(() =>
            getApi().sendMessage(chatId, chunk, {
              parse_mode: finalMode,
              disable_notification,
              reply_parameters:
                i === 0 && reply_to_message_id !== undefined
                  ? { message_id: reply_to_message_id }
                  : undefined,
              _rawText: chunks.length === 1 ? text : undefined,
            } as Record<string, unknown>),
          );
          message_ids.push(msg.message_id);
        }

        if (message_ids.length === 1) {
          return toResult({ message_id: message_ids[0] });
        }
        return toResult({ message_ids, split_count: message_ids.length, split: true });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
