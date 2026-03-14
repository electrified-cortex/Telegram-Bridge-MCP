import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { applyTopicToTitle } from "../topic-state.js";
import { renderProgress } from "./send_new_progress.js";

const DEFAULT_WIDTH = 10;

const DESCRIPTION =
  "Edits an existing progress bar message in-place. " +
  "Pass the message_id returned by send_new_progress. " +
  "All parameters are required on every call — the server does not persist bar state.";

export function register(server: McpServer) {
  server.registerTool(
    "update_progress",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z
          .number()
          .int()
          .describe("ID of the progress bar message to update"),
        title: z.string().describe("Bold heading"),
        percent: z
          .number()
          .min(0)
          .max(100)
          .describe("Progress percentage (0–100)"),
        subtext: z
          .string()
          .optional()
          .describe("Optional italicized detail line below the bar"),
        width: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(DEFAULT_WIDTH)
          .describe(`Bar width in characters. Default ${DEFAULT_WIDTH}.`),
      },
    },
    async ({ message_id, title, percent, subtext, width }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const text = renderProgress(applyTopicToTitle(title), percent, width, subtext);
        const textErr = validateText(text);
        if (textErr) return toError(textErr);
        const result = await getApi().editMessageText(
          chatId,
          message_id,
          text,
          { parse_mode: "HTML" },
        );
        const edited = typeof result === "boolean" ? { message_id } : result;
        return toResult({ message_id: edited.message_id, updated: true });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
