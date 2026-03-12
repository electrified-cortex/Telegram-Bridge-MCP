import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getApi, resolveChat,
  toResult, toError, validateText, validateCallbackData, LIMITS,
} from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";
import { clearPendingTemp } from "../temp-message.js";
import { applyTopicToText } from "../topic-state.js";
import { pollButtonOrTextOrVoice, ackAndEditSelection, editWithSkipped, editWithTimedOut } from "./button-helpers.js";
import { recordOutgoing } from "../message-store.js";

const DESCRIPTION =
  "Sends a question with 2–8 labeled option buttons and waits until the " +
  "user presses one. Returns { label, value } of the chosen option. " +
  "Automatically removes the buttons and updates the message to show the " +
  "chosen option. If the user sends a text or voice message instead, " +
  "returns { skipped: true, text_response }. If no input arrives within " +
  "timeout_seconds, buttons are removed, the message is marked Skipped, " +
  "and returns { timed_out: true }. Multiple choose calls can be chained " +
  "for questionnaires. Use for any single-selection choice.";

export function register(server: McpServer) {
  server.registerTool(
    "choose",
    {
      description: DESCRIPTION,
      inputSchema: {
        question: z.string().describe("The question to display above the buttons"),
      options: z
        .array(
          z.object({
            label: z.string().describe(`Button label. Keep under ${LIMITS.BUTTON_DISPLAY_MULTI_COL} chars for 2-col layout, or ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars for single-column. API hard limit is ${LIMITS.BUTTON_TEXT} chars but labels over the display limit are cut off on mobile.`),
            value: z.string().describe(`Callback data (max ${LIMITS.CALLBACK_DATA} bytes)`),
            style: z
              .enum(["success", "primary", "danger"])
              .optional()
              .describe("Optional button color: success (green), primary (blue), danger (red). Omit for default app style."),
          })
        )
        .min(2)
        .max(8)
        .describe("2–8 options. Buttons are laid out 2 per row automatically."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(300)
        .describe("Seconds to wait before returning timed_out: true and removing buttons (default 300 — buttons stay live for 5 minutes). A text or voice message from the user will immediately return skipped regardless of timeout."),
      columns: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("Buttons per row (default 2)"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID — shows quoted message above the question"),
      },
    },
    async ({ question, options, timeout_seconds, columns, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      const textErr = validateText(question);
      if (textErr) return toError(textErr);

      // Validate all callback data up front
      const displayMax = columns >= 2
        ? LIMITS.BUTTON_DISPLAY_MULTI_COL
        : LIMITS.BUTTON_DISPLAY_SINGLE_COL;
      for (const opt of options) {
        const dataErr = validateCallbackData(opt.value);
        if (dataErr) return toError(dataErr);
        if (opt.label.length > LIMITS.BUTTON_TEXT)
          return toError({
            code: "BUTTON_DATA_INVALID" as const,
            message: `Button label "${opt.label}" is ${opt.label.length} chars but the Telegram limit is ${LIMITS.BUTTON_TEXT}.`,
          });
        if (opt.label.length > displayMax)
          return toError({
            code: "BUTTON_LABEL_TOO_LONG" as const,
            message: `Button label "${opt.label}" (${opt.label.length} chars) will be cut off on mobile. With columns=${columns}, keep labels under ${displayMax} chars. Use columns=1 for longer labels (max ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars).`,
          });
      }

      // Build keyboard rows (n columns per row)
      const rows: { text: string; callback_data: string; style?: "success" | "primary" | "danger" }[][] = [];
      for (let i = 0; i < options.length; i += columns) {
        rows.push(
          options.slice(i, i + columns).map((o) => ({
            text: o.label,
            callback_data: o.value,
            ...(o.style ? { style: o.style } : {}),
          }))
        );
      }

      try {
        cancelTyping();
        clearPendingTemp();
        const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(question, "Markdown")), {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: rows },
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
        });
        recordOutgoing(sent.message_id, "text", question);

        const match = await pollButtonOrTextOrVoice(chatId, sent.message_id, timeout_seconds);

        if (!match) {
          // Timeout — remove buttons so they can't be clicked with no listener.
          // The agent can call dequeue_update next to capture a free-text reply.
          await editWithTimedOut(chatId, sent.message_id, question);
          return toResult({
            timed_out: true,
            message_id: sent.message_id,
          });
        }

        if (match.kind === "text") {
          await editWithSkipped(chatId, sent.message_id, question);
          return toResult({
            skipped: true,
            text_response: match.text,
            text_message_id: match.message_id,
            message_id: sent.message_id,
          });
        }

        if (match.kind === "voice") {
          await editWithSkipped(chatId, sent.message_id, question);
          return toResult({
            skipped: true,
            text_response: match.text ?? "[no transcription]",
            text_message_id: match.message_id,
            message_id: sent.message_id,
            voice: true,
          });
        }

        // Button was pressed
        const chosen = options.find((o) => o.value === match.data);
        const chosenLabel = chosen?.label ?? match.data ?? "";
        await ackAndEditSelection(chatId, sent.message_id, question, chosenLabel, match.callback_query_id);

        return toResult({
          timed_out: false,
          label: chosenLabel,
          value: match.data,
          message_id: sent.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
