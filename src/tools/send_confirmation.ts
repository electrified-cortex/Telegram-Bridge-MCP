import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";
import { clearPendingTemp } from "../temp-message.js";
import { applyTopicToText } from "../topic-state.js";
import { pollButtonPress, ackAndEditSelection, editWithTimedOut } from "./button-helpers.js";

/**
 * Convenience tool for agent→human Yes/No confirmation flows.
 *
 * Fully self-contained — mirrors `choose` but hardcoded to two options:
 *   1. Sends the question with Yes/No inline buttons
 *   2. Blocks until the user presses one (or timeout)
 *   3. Answers the callback_query (removes the spinner)
 *   4. Edits the message to show the chosen label (buttons removed)
 *   5. Returns { confirmed: true|false }
 *
 * Use `wait_for_callback_query` directly only when buttons must remain
 * interactive across multiple presses (e.g. broadcast / persistent keyboards).
 */
export function register(server: McpServer) {
  server.tool(
    "send_confirmation",
    "Sends a Yes/No confirmation message and blocks until the user presses a button. Automatically removes buttons and updates the message to show the chosen option. Returns { confirmed: true|false }.",
    {
      text: z
        .string()
        .describe("The question or request requiring confirmation"),
      yes_text: z
        .string()
        .default("🟢 Yes")
        .describe("Label for the affirmative button. When using yes_style, prefer plain text — the button color is the visual signal."),
      no_text: z
        .string()
        .default("🔴 No")
        .describe("Label for the negative button. When using no_style, prefer plain text — the button color is the visual signal."),
      yes_data: z
        .string()
        .default("confirm_yes")
        .describe("Callback data sent when Yes is pressed"),
      no_data: z
        .string()
        .default("confirm_no")
        .describe("Callback data sent when No is pressed"),
      yes_style: z
        .enum(["success", "primary", "danger"])
        .optional()
        .describe("Optional color for the Yes button: success (green), primary (blue), danger (red). Omit for app-default style. Tip: use primary+no style for a confirm/cancel emphasis pattern."),
      no_style: z
        .enum(["success", "primary", "danger"])
        .optional()
        .describe("Optional color for the No button: success (green), primary (blue), danger (red). Omit for app-default (gray/neutral)."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(60)
        .describe("Seconds to wait for a button press before returning timed_out: true"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID — shows quoted message above the confirmation"),
    },
    async ({ text, yes_text, no_text, yes_data, no_data, yes_style, no_style, timeout_seconds, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const textErr = validateText(text);
      if (textErr) return toError(textErr);

      try {
        cancelTyping();
        await clearPendingTemp();
        const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(text, "Markdown")), {
          parse_mode: "MarkdownV2",
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
          reply_markup: {
            inline_keyboard: [[
              { text: yes_text, callback_data: yes_data, ...(yes_style ? { style: yes_style } : {}) },
              { text: no_text, callback_data: no_data, ...(no_style ? { style: no_style } : {}) },
            ]],
          },
        });

        const cq = await pollButtonPress(chatId, sent.message_id, timeout_seconds);

        if (!cq) {
          await editWithTimedOut(chatId, sent.message_id, text);
          return toResult({ timed_out: true, message_id: sent.message_id });
        }

        const confirmed = cq.data === yes_data;
        const chosenLabel = confirmed ? yes_text : no_text;
        await ackAndEditSelection(chatId, sent.message_id, text, chosenLabel, cq.id!);

        return toResult({
          timed_out: false,
          confirmed,
          value: cq.data,
          message_id: sent.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
