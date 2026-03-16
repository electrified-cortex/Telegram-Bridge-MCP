import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toResult, toError, validateText, resolveChat, validateCallbackData, LIMITS, getApi,
} from "../telegram.js";
import { registerCallbackHook } from "../message-store.js";
import {
  sendChoiceMessage, type KeyboardOption,
} from "./button-helpers.js";

const DESCRIPTION =
  "Non-blocking one-shot keyboard — sends a message with choice buttons and " +
  "returns immediately with a message_id. The first button press is auto-locked: " +
  "the keyboard is removed and the callback_query is answered automatically. " +
  "The callback_query event still appears in dequeue_update so the agent can read " +
  "which option was picked at its own pace. " +
  "Use choose for blocking single-selection (waits for the press). " +
  "Use send_message for persistent keyboards that stay live indefinitely. " +
  "Ensure session_start has been called.";

const optionSchema = z.object({
  label: z
    .string()
    .describe(
      `Button label. Keep under ${LIMITS.BUTTON_DISPLAY_MULTI_COL} chars for 2-col layout, ` +
      `or ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars for single-column. ` +
      `API hard limit is ${LIMITS.BUTTON_TEXT} chars.`,
    ),
  value: z
    .string()
    .describe(`Callback data returned when pressed (max ${LIMITS.CALLBACK_DATA} bytes)`),
  style: z
    .enum(["success", "primary", "danger"])
    .optional()
    .describe("Button color: success (green), primary (blue), danger (red). Omit for default."),
});

export function register(server: McpServer) {
  server.registerTool(
    "send_choice",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Message text — the question or prompt shown above the buttons"),
        options: z
          .array(optionSchema)
          .min(2)
          .max(8)
          .describe("2–8 options. Laid out per the columns setting."),
        columns: z
          .number()
          .int()
          .min(1)
          .max(4)
          .default(2)
          .describe("Buttons per row (default 2)"),
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
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
      },
    },
    async ({ text, options, columns, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const textErr = validateText(text);
      if (textErr) return toError(textErr);

      // Validate options — same rules as choose
      const displayMax = columns >= 2
        ? LIMITS.BUTTON_DISPLAY_MULTI_COL
        : LIMITS.BUTTON_DISPLAY_SINGLE_COL;
      for (const opt of options) {
        const dataErr = validateCallbackData(opt.value);
        if (dataErr) return toError(dataErr);
        if (opt.label.length > LIMITS.BUTTON_TEXT) {
          return toError({
            code: "BUTTON_LABEL_EXCEEDS_LIMIT" as const,
            message: `Button label "${opt.label}" is ${opt.label.length} chars; hard limit is ${LIMITS.BUTTON_TEXT}.`,
          });
        }
        if (opt.label.length > displayMax) {
          return toError({
            code: "BUTTON_LABEL_TOO_LONG" as const,
            message:
              `Button label "${opt.label}" (${opt.label.length} chars) will be cut off on mobile. ` +
              `With columns=${columns}, keep labels under ${displayMax} chars.`,
          });
        }
      }

      try {
        const messageId = await sendChoiceMessage(chatId, {
          text,
          options: options as KeyboardOption[],
          columns,
          parseMode: parse_mode,
          disableNotification: disable_notification,
          replyToMessageId: reply_to_message_id,
        });

        // Register one-shot auto-lock: on first press, dismiss the spinner and
        // remove the buttons. The callback_query event is still enqueued normally.
        registerCallbackHook(messageId, (evt) => {
          const qid = evt.content.qid;
          void (async () => {
            if (qid) {
              await getApi().answerCallbackQuery(qid).catch(() => { /* non-fatal */ });
            }
            await getApi()
              .editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } })
              .catch(() => { /* non-fatal */ });
          })();
        });

        return toResult({ message_id: messageId });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
