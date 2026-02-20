import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getApi, getOffset, advanceOffset,
  toResult, toError, validateText, validateCallbackData, LIMITS,
} from "../telegram.js";

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
      chat_id: z.string().describe("Target chat ID or @username"),
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
    async ({ chat_id, question, options, timeout_seconds, columns }) => {
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
        const sent = await getApi().sendMessage(chat_id, question, {
          reply_markup: { inline_keyboard: rows },
        });

        // Long-poll for the callback_query from this message
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        advanceOffset(updates);

        const match = updates.find(
          (u) =>
            u.callback_query &&
            u.callback_query.message?.message_id === sent.message_id &&
            String(u.callback_query.message?.chat.id) === chat_id
        );

        if (!match?.callback_query) {
          return toResult({ timed_out: true, message_id: sent.message_id });
        }

        const cq = match.callback_query;
        const chosen = options.find((o) => o.value === cq.data);

        // Acknowledge the callback so Telegram removes the loading spinner
        await getApi().answerCallbackQuery(cq.id).catch(() => {/* non-fatal */});

        return toResult({
          timed_out: false,
          label: chosen?.label ?? cq.data,
          value: cq.data,
          from: {
            id: cq.from.id,
            username: cq.from.username,
            first_name: cq.from.first_name,
          },
          message_id: sent.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
