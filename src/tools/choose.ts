import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Update } from "grammy/types";
import { z } from "zod";
import {
  getApi, resolveChat,
  toResult, toError, validateText, validateCallbackData, LIMITS,
  pollUntil,
} from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { transcribeWithIndicator } from "../transcribe.js";

/**
 * Sends a question with labeled option buttons and blocks until one is pressed.
 * Handles the full flow: send message → wait for callback_query → answer it
 * (to dismiss the spinner) → return the chosen option.
 *
 * Replaces the manual: send_message + wait_for_callback_query + answer_callback_query chain.
 */
export function register(server: McpServer) {
  server.tool(
    "choose",
    "Sends a question with 2–8 labeled option buttons and blocks until the user presses one. Returns { label, value } of the chosen option. Handles answering the callback_query automatically. Use instead of send_confirmation for any choice with more than Yes/No.",
    {
      question: z.string().describe("The question to display above the buttons"),
      options: z
        .array(
          z.object({
            label: z.string().describe(`Button label (max ${LIMITS.BUTTON_TEXT} chars)`),
            value: z.string().describe(`Callback data (max ${LIMITS.CALLBACK_DATA} bytes)`),
          })
        )
        .min(2)
        .max(8)
        .describe("2–8 options. Buttons are laid out 2 per row automatically."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("Seconds to wait for a button press before returning timed_out: true"),
      columns: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("Buttons per row (default 2)"),
    },
    async ({ question, options, timeout_seconds, columns }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const textErr = validateText(question);
      if (textErr) return toError(textErr);

      // Validate all callback data up front
      for (const opt of options) {
        const dataErr = validateCallbackData(opt.value);
        if (dataErr) return toError(dataErr);
        if (opt.label.length > LIMITS.BUTTON_TEXT)
          return toError({
            code: "BUTTON_DATA_INVALID" as const,
            message: `Button label "${opt.label}" is ${opt.label.length} chars but the Telegram limit is ${LIMITS.BUTTON_TEXT}.`,
          });
      }

      // Build keyboard rows (n columns per row)
      const rows: { text: string; callback_data: string }[][] = [];
      for (let i = 0; i < options.length; i += columns) {
        rows.push(
          options.slice(i, i + columns).map((o) => ({
            text: o.label,
            callback_data: o.value,
          }))
        );
      }

      try {
        const sent = await getApi().sendMessage(chatId, markdownToV2(question), {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: rows },
        });

        // Poll with 1 s ticks until EITHER a callback_query for this message
        // OR a text/voice message arrives — whichever comes first.
        const { match } = await pollUntil<
          | { kind: "button"; cq: NonNullable<Update["callback_query"]> }
          | { kind: "text"; message_id: number; text: string }
          | { kind: "voice"; message_id: number; fileId: string }
        >(
          (updates) => {
            // Check for a callback_query on our message first
            const cq = updates.find(
              (u) =>
                u.callback_query &&
                u.callback_query.message?.message_id === sent.message_id &&
                String(u.callback_query.message?.chat.id) === chatId
            );
            if (cq?.callback_query) return { kind: "button", cq: cq.callback_query };

            // Check for a text message (user typed instead of pressing a button)
            const tm = updates.find((u) => u.message?.text);
            if (tm?.message) return { kind: "text", message_id: tm.message.message_id, text: tm.message.text! };

            // Check for a voice message (user spoke instead of pressing a button)
            const vm = updates.find((u) => u.message?.voice);
            if (vm?.message?.voice) return { kind: "voice", message_id: vm.message.message_id, fileId: vm.message.voice.file_id };

            return undefined;
          },
          timeout_seconds,
        );

        if (!match) {
          // Timeout — keep buttons active (no edit), let user press later
          return toResult({
            timed_out: true,
            message_id: sent.message_id,
          });
        }

        if (match.kind === "text") {
          // User typed text instead of pressing a button — choice is skipped
          // Edit message to show "⏭ Skipped" and remove the now-irrelevant buttons
          await getApi()
            .editMessageText(chatId, sent.message_id, markdownToV2(`${question}\n\n⏭ _Skipped_`), {
              parse_mode: "MarkdownV2",
              reply_markup: { inline_keyboard: [] },
            })
            .catch((e) => { console.error("[choose] editMessageText (skipped) failed:", e); });

          return toResult({
            skipped: true,
            text_response: match.text,
            text_message_id: match.message_id,
            message_id: sent.message_id,
          });
        }

        if (match.kind === "voice") {
          // User sent a voice message instead of pressing a button — transcribe and treat as text skip
          const text = await transcribeWithIndicator(match.fileId, match.message_id).catch((e) => `[transcription failed: ${e.message}]`);
          await getApi()
            .editMessageText(chatId, sent.message_id, markdownToV2(`${question}\n\n⏭ _Skipped_`), {
              parse_mode: "MarkdownV2",
              reply_markup: { inline_keyboard: [] },
            })
            .catch((e) => { console.error("[choose] editMessageText (skipped/voice) failed:", e); });

          return toResult({
            skipped: true,
            text_response: text,
            text_message_id: match.message_id,
            message_id: sent.message_id,
            voice: true,
          });
        }

        // Button was pressed
        const chosen = options.find((o) => o.value === match.cq.data);
        const chosenLabel = chosen?.label ?? match.cq.data;

        // Acknowledge the callback so Telegram removes the loading spinner
        await getApi().answerCallbackQuery(match.cq.id).catch(() => {/* non-fatal */});

        // Replace the buttons with a text confirmation of the choice
        const updatedText = `${question}\n\n▸ *${chosenLabel}*`;
        await getApi()
          .editMessageText(chatId, sent.message_id, markdownToV2(updatedText), {
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: [] },
          })
          .catch((e) => { console.error("[choose] editMessageText failed:", e); });

        return toResult({
          timed_out: false,
          label: chosenLabel,
          value: match.cq.data,
          message_id: sent.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
