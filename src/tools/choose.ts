import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveChat,
  toResult, toError, validateText, validateCallbackData, LIMITS,
} from "../telegram.js";
import { registerCallbackHook, clearCallbackHook, registerMessageHook, clearMessageHook } from "../message-store.js";
import {
  pollButtonOrTextOrVoice, ackAndEditSelection, editWithSkipped,
  sendChoiceMessage, type KeyboardOption,
} from "./button-helpers.js";

const DESCRIPTION =
  "Sends a question with 2–8 labeled option buttons and waits until the " +
  "user presses one. Returns { label, value } of the chosen option. " +
  "Automatically removes the buttons and updates the message to show the " +
  "chosen option. If the user sends a text or voice message instead, " +
  "returns { skipped: true, text_response }. If no input arrives within " +
  "timeout_seconds, returns { timed_out: true } — buttons remain live and " +
  "late clicks are still handled automatically. Multiple choose calls can " +
  "be chained for questionnaires. Use for any single-selection choice.";

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
        .min(1)
        .optional()
        .describe("Reply to this message ID — shows quoted message above the question"),
      },
    },
    async ({ question, options, timeout_seconds, columns, reply_to_message_id }, { signal }) => {
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

      try {
        const messageId = await sendChoiceMessage(chatId, {
          text: question,
          options: options as KeyboardOption[],
          columns,
          parseMode: "Markdown",
          replyToMessageId: reply_to_message_id,
        });

        // Register callback hook — handles button clicks even after poll timeout.
        // One-shot: acks, shows selection, removes buttons. Event still queues for dequeue_update.
        registerCallbackHook(messageId, (evt) => {
          const chosen = options.find((o) => o.value === evt.content.data);
          const chosenLabel = chosen?.label ?? evt.content.data ?? "";
          clearMessageHook(messageId);
          void ackAndEditSelection(chatId, messageId, question, chosenLabel, evt.content.qid)
            .catch((e: unknown) => process.stderr.write(`[warn] choose hook failed: ${String(e)}\n`));
        });

        // Fires immediately when a voice message is detected (before transcription).
        // This removes the keyboard right away so the user doesn't see a delayed edit.
        let skippedEditDone = false;
        const onVoiceDetected = () => {
          skippedEditDone = true;
          clearCallbackHook(messageId);
          editWithSkipped(chatId, messageId, question).catch(() => {/* non-fatal */});
        };

        const match = await pollButtonOrTextOrVoice(chatId, messageId, timeout_seconds, onVoiceDetected, signal);

        if (!match) {
          // Timeout — register a message hook so the next user message
          // cleans up the stale buttons (callback hook handles late clicks).
          registerMessageHook(messageId, () => {
            clearCallbackHook(messageId);
            editWithSkipped(chatId, messageId, question).catch(() => {/* non-fatal */});
          });
          return toResult({
            timed_out: true,
            message_id: messageId,
          });
        }

        if (match.kind === "text") {
          clearCallbackHook(messageId);
          await editWithSkipped(chatId, messageId, question);
          return toResult({
            skipped: true,
            text_response: match.text,
            text_message_id: match.message_id,
            message_id: messageId,
          });
        }

        if (match.kind === "voice") {
          clearCallbackHook(messageId);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- skippedEditDone may be true if onVoiceDetected fired before poll returned
          if (!skippedEditDone) await editWithSkipped(chatId, messageId, question);
          return toResult({
            skipped: true,
            text_response: match.text ?? "[no transcription]",
            text_message_id: match.message_id,
            message_id: messageId,
            voice: true,
          });
        }

        if (match.kind === "command") {
          clearCallbackHook(messageId);
          await editWithSkipped(chatId, messageId, question);
          return toResult({
            skipped: true,
            command: match.command,
            args: match.args,
            message_id: messageId,
          });
        }

        // Button was pressed — hook already acked + edited.
        const chosen = options.find((o) => o.value === match.data);
        const chosenLabel = chosen?.label ?? match.data;

        return toResult({
          timed_out: false,
          label: chosenLabel,
          value: match.data,
          message_id: messageId,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
