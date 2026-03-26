import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { applyTopicToTitle } from "../topic-state.js";
import { renderProgress } from "./send_new_progress.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

/** Message IDs that have already received a completion reply — prevents duplicates. */
const _completedMessageIds = new Set<number>();

/** @internal reset for unit tests only */
export function resetCompletionTrackingForTest(): void {
  _completedMessageIds.clear();
}

const DEFAULT_WIDTH = 10;

const DESCRIPTION =
  "Edits an existing progress bar message in-place. " +
  "Pass the message_id returned by send_new_progress. " +
  "Only percent is required — omit title and subtext to keep the bar-only layout, " +
  "or pass empty string to clear them. " +
  "Auto-unpins the message when percent reaches 100.";

export function register(server: McpServer) {
  server.registerTool(
    "update_progress",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z
          .number()
          .int()
          .min(1)
          .describe("ID of the progress bar message to update"),
        percent: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe("Progress percentage (0–100)"),
        title: z
          .string()
          .optional()
          .describe("Bold heading. Omit or pass empty string to render bar only."),
        subtext: z
          .string()
          .optional()
          .describe("Optional italicized detail line below the bar. Pass empty string to clear."),
        width: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(DEFAULT_WIDTH)
          .describe(`Bar width in characters. Default ${DEFAULT_WIDTH}.`),
              identity: IDENTITY_SCHEMA,
},
    },
    async ({ message_id, percent, title, subtext, width, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const topicTitle = title ? applyTopicToTitle(title) : undefined;
        const text = renderProgress(percent, width, topicTitle, subtext);
        const textErr = validateText(text);
        if (textErr) return toError(textErr);
        const result = await getApi().editMessageText(
          chatId,
          message_id,
          text,
          { parse_mode: "HTML" },
        );
        const edited = typeof result === "boolean" ? { message_id } : result;
        if (percent === 100) {
          getApi().unpinChatMessage(chatId, message_id).catch(() => {});
          if (!_completedMessageIds.has(message_id)) {
            _completedMessageIds.add(message_id);
            getApi().sendMessage(chatId, "✅ Complete", {
              reply_to_message_id: message_id,
              _skipHeader: true,
            } as Record<string, unknown>).catch(() => {});
          }
        }
        return toResult({ message_id: edited.message_id, updated: true });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
