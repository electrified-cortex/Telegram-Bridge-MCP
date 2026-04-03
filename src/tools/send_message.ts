import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getApi, toResult, toError, validateText, resolveChat, validateCallbackData, LIMITS, callApi,
} from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import type { ButtonStyle } from "./button-helpers.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Core send primitive — sends a message to the Telegram chat and returns immediately " +
  "with a message_id. Optionally attach an inline keyboard (buttons). " +
  "Default parse_mode is Markdown (auto-converted). Does not auto-split long text — " +
  "use send_text for messages longer than 4096 chars or when no keyboard is needed. " +
  "When keyboard is provided, handle button presses via dequeue_update and " +
  "answer_callback_query — there is no blocking wait. " +
  "For blocking single-selection, use choose. For yes/no, use confirm. " +
  "For voice/TTS, use send_text_as_voice. " +
  "Ensure session_start has been called.";

const buttonSchema = z.object({
  label: z
    .string()
    .describe(
      `Button label text. Keep under ${LIMITS.BUTTON_DISPLAY_MULTI_COL} chars for ` +
      `multi-column layout or under ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars for single column. ` +
      `Hard limit is ${LIMITS.BUTTON_TEXT} chars.`,
    ),
  value: z
    .string()
    .describe(`Callback data returned when pressed (max ${LIMITS.CALLBACK_DATA} bytes)`),
  style: z
    .enum(["success", "primary", "danger"])
    .optional()
    .describe("Button background color: success (green), primary (blue), danger (red). Omit for default."),
});

export function register(server: McpServer) {
  server.registerTool(
    "send_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Message text"),
        keyboard: z
          .array(z.array(buttonSchema))
          .optional()
          .describe(
            "Inline keyboard: outer array = rows, inner array = buttons in each row. " +
            "Button presses arrive as callback_query events via dequeue_update.",
          ),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Markdown = auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send silently (no sound/notification)"),
        reply_to_message_id: z
          .number()
          .int()
          .optional()
          .describe("Thread this message as a reply to the given message ID"),
              token: TOKEN_SCHEMA,
},
    },
    async ({ text, keyboard, parse_mode, disable_notification, reply_to_message_id, token}) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      if (keyboard) {
        for (const row of keyboard) {
          for (const btn of row) {
            const dataErr = validateCallbackData(btn.value);
            if (dataErr) return toError(dataErr);
            if (btn.label.length > LIMITS.BUTTON_TEXT) {
              return toError({
                code: "BUTTON_DATA_INVALID" as const,
                message: `Button label "${btn.label}" is ${btn.label.length} chars; Telegram hard limit is ${LIMITS.BUTTON_TEXT}.`,
              });
            }
          }
        }
      }

      const textWithTopic = applyTopicToText(text, parse_mode);
      const { text: finalText, parse_mode: finalMode } = resolveParseMode(textWithTopic, parse_mode);
      const textErr = validateText(finalText);
      if (textErr) return toError(textErr);

      const inlineKeyboard = keyboard?.map((row) =>
        row.map((btn) => ({
          text: btn.label,
          callback_data: btn.value,
          ...(btn.style ? { style: btn.style as ButtonStyle } : {}),
        })),
      );

      try {
        const msg = await callApi(() =>
          getApi().sendMessage(chatId, finalText, {
            parse_mode: finalMode,
            disable_notification,
            reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
            reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined,
            _rawText: text,
          } as Record<string, unknown>),
        );
        return toResult({ message_id: msg.message_id });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
