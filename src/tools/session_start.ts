import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { dequeue, pendingCount } from "../message-store.js";
import {
  pollButtonPress,
  ackAndEditSelection,
} from "./button-helpers.js";

const DEFAULT_INTRO = "\u2139\uFE0F Session Start";

const FRESH_DATA = "session_fresh";
const RESUME_DATA = "session_resume";
const FRESH_LABEL = "Start Fresh";
const RESUME_LABEL = "\u25B6\uFE0F Resume";

/** Wait up to 10 minutes — effectively no timeout. */
const CONFIRM_TIMEOUT_S = 600;

const DESCRIPTION =
  "Call once at the start of every session. Sends an intro " +
  "message, checks for pending messages from a previous " +
  "session, and — if any exist — asks the operator whether " +
  "to resume or start fresh. Returns { action, pending } " +
  "so the agent knows how to proceed.";

export function register(server: McpServer) {
  server.registerTool(
    "session_start",
    {
      description: DESCRIPTION,
      inputSchema: {
        intro: z
          .string()
          .default(DEFAULT_INTRO)
          .describe(
            "Markdown text for the intro message. " +
            "Defaults to \"ℹ️ Session Start\".",
          ),
      },
    },
    async ({ intro }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      try {
        // 1. Send the intro message
        const sent = await getApi().sendMessage(
          chatId,
          markdownToV2(intro),
          {
            parse_mode: "MarkdownV2",
            disable_notification: true,
            _rawText: intro,
          } as Record<string, unknown>,
        );
        const introId: number = sent.message_id;

        // 2. Check pending count
        const pending = pendingCount();
        if (pending === 0) {
          return toResult({
            action: "fresh",
            pending: 0,
            intro_message_id: introId,
          });
        }

        // 3. Ask the operator
        const plural = pending === 1 ? "message" : "messages";
        const confirmText =
          `${pending} ${plural} from a previous session.`;

        const confirmSent = await getApi().sendMessage(
          chatId,
          markdownToV2(confirmText),
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [[
                { text: FRESH_LABEL, callback_data: FRESH_DATA },
                { text: RESUME_LABEL, callback_data: RESUME_DATA },
              ]],
            },
            _rawText: confirmText,
          } as Record<string, unknown>,
        );

        // 4. Wait for button press
        const result = await pollButtonPress(
          chatId,
          confirmSent.message_id,
          CONFIRM_TIMEOUT_S,
        );

        if (!result) {
          // Extremely unlikely (10 min timeout), treat as fresh
          return toResult({
            action: "fresh",
            discarded: 0,
            intro_message_id: introId,
          });
        }

        const chosenLabel =
          result.data === FRESH_DATA ? FRESH_LABEL : RESUME_LABEL;
        await ackAndEditSelection(
          chatId,
          confirmSent.message_id,
          confirmText,
          chosenLabel,
          result.callback_query_id,
        );

        if (result.data === RESUME_DATA) {
          return toResult({
            action: "resume",
            pending,
            intro_message_id: introId,
          });
        }

        // 5. Drain all pending messages
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        return toResult({
          action: "fresh",
          discarded,
          intro_message_id: introId,
        });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
