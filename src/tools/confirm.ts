import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText, validateCallbackData } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import { registerCallbackHook, clearCallbackHook, registerMessageHook, clearMessageHook } from "../message-store.js";
import {
  pollButtonOrTextOrVoice, ackAndEditSelection, editWithSkipped,
  type ButtonStyle,
} from "./button-helpers.js";

const DESCRIPTION =
  "Sends a Yes/No confirmation message and waits until the user presses a " +
  "button. Automatically removes buttons and updates the message to show the " +
  "chosen option. Returns { confirmed: true|false }, or { timed_out: true } " +
  "if the timeout expires without input.";

export function register(server: McpServer) {
  server.registerTool(
    "confirm",
    {
      description: DESCRIPTION,
      inputSchema: {
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
        .describe("Label for the negative button. Set to empty string to show only the primary/yes button (single-button CTA mode). When using no_style, prefer plain text — the button color is the visual signal."),
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
        .min(1)
        .optional()
        .describe("Reply to this message ID — shows quoted message above the confirmation"),
      },
    },
    async ({ text, yes_text, no_text, yes_data, no_data, yes_style, no_style, timeout_seconds, reply_to_message_id }, { signal }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      const textErr = validateText(text);
      if (textErr) return toError(textErr);
      const yesDataErr = validateCallbackData(yes_data);
      if (yesDataErr) return toError(yesDataErr);
      if (no_text) {
        const noDataErr = validateCallbackData(no_data);
        if (noDataErr) return toError(noDataErr);
      }

      try {
        const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(text, "Markdown")), {
          parse_mode: "MarkdownV2",
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
          reply_markup: {
            inline_keyboard: [[
              { text: yes_text, callback_data: yes_data, ...(yes_style ? { style: yes_style as ButtonStyle } : {}) },
              ...(no_text ? [{ text: no_text, callback_data: no_data, ...(no_style ? { style: no_style as ButtonStyle } : {}) }] : []),
            ]],
          },
          _rawText: text,
        } as Record<string, unknown>);

        // Register callback hook — handles button clicks even after poll timeout.
        // One-shot: acks, shows selection, removes buttons. Event still queues for dequeue_update.
        registerCallbackHook(sent.message_id, (evt) => {
          const confirmed = evt.content.data === yes_data;
          // In single-button CTA mode (no_text is ""), ignore anything that isn't yes_data.
          if (!confirmed && !no_text) return;
          clearMessageHook(sent.message_id);
          const chosenLabel = confirmed ? yes_text : no_text;
          void ackAndEditSelection(chatId, sent.message_id, text, chosenLabel, evt.content.qid)
            .catch((e: unknown) => process.stderr.write(`[warn] confirm hook failed: ${String(e)}\n`));
        });

        // Fires immediately when a voice message is detected (before transcription).
        // This removes the keyboard right away so the user doesn't see a delayed edit.
        const editState = { done: false };
        const onVoiceDetected = () => {
          editState.done = true;
          clearCallbackHook(sent.message_id);
          editWithSkipped(chatId, sent.message_id, text).catch(() => {/* non-fatal */});
        };

        const result = await pollButtonOrTextOrVoice(chatId, sent.message_id, timeout_seconds, onVoiceDetected, signal);

        if (!result) {
          // Timeout — register a message hook so the next user message
          // cleans up the stale buttons (callback hook handles late clicks).
          registerMessageHook(sent.message_id, () => {
            clearCallbackHook(sent.message_id);
            editWithSkipped(chatId, sent.message_id, text).catch(() => {/* non-fatal */});
          });
          return toResult({ timed_out: true, message_id: sent.message_id });
        }

        // User typed or spoke instead of pressing a button — mark as skipped
        if (result.kind === "text" || result.kind === "voice") {
          clearCallbackHook(sent.message_id);
          if (!editState.done) await editWithSkipped(chatId, sent.message_id, text);
          return toResult({
            skipped: true,
            text_response: result.text,
            text_message_id: result.message_id,
            message_id: sent.message_id,
          });
        }

        // Slash command interrupted the confirmation — mark as skipped
        if (result.kind === "command") {
          clearCallbackHook(sent.message_id);
          await editWithSkipped(chatId, sent.message_id, text);
          return toResult({
            skipped: true,
            command: result.command,
            args: result.args,
            message_id: sent.message_id,
          });
        }

        // Button was pressed — hook already acked + edited.
        const confirmed = result.data === yes_data;

        return toResult({
          timed_out: false,
          confirmed,
          value: result.data,
          message_id: sent.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
