import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { escapeHtml } from "../markdown.js";
import { applyTopicToTitle } from "../topic-state.js";

const FILLED = "▓";
const EMPTY  = "░";
const DEFAULT_WIDTH = 10;

export function renderProgress(
  title: string,
  percent: number,
  width: number,
  subtext?: string,
): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = FILLED.repeat(filled) + EMPTY.repeat(empty);
  const pct = `${Math.round(clamped)}%`;
  const lines = [`<b>${escapeHtml(title)}</b>`, `${bar}  ${pct}`];
  if (subtext) lines.push(`<i>${escapeHtml(subtext)}</i>`);
  return lines.join("\n");
}

const DESCRIPTION =
  "Creates a new progress bar message and returns its message_id. " +
  "Pass the returned message_id to update_progress to edit in-place. " +
  "Multiple concurrent progress bars are supported — each is tracked by its own message_id.";

export function register(server: McpServer) {
  server.registerTool(
    "send_new_progress",
    {
      description: DESCRIPTION,
      inputSchema: {
        title: z.string().describe("Bold heading, e.g. \"Building dist/\""),
        percent: z
          .number()
          .min(0)
          .max(100)
          .describe("Progress percentage (0–100)"),
        subtext: z
          .string()
          .optional()
          .describe("Optional italicized detail line below the bar, e.g. \"12 / 24 files\""),
        width: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(DEFAULT_WIDTH)
          .describe(`Bar width in characters. Default ${DEFAULT_WIDTH}.`),
      },
    },
    async ({ title, percent, subtext, width }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const text = renderProgress(applyTopicToTitle(title), percent, width, subtext);
        const textErr = validateText(text);
        if (textErr) return toError(textErr);
        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode: "HTML",
          _rawText: title,
        } as Record<string, unknown>);
        return toResult({
          message_id: msg.message_id,
          hint: "Pass this message_id to update_progress to edit in-place.",
        });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
