import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, routeOutboundMessage, toResult, toError, resolveChat, validateText } from "../../telegram.js";
import { escapeHtml } from "../../markdown.js";
import { applyTopicToTitle } from "../../topic-state.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { armStaleTimer } from "./stale-timer.js";

const FILLED = "▓";
const EMPTY = "░";
const DEFAULT_WIDTH = 10;

export function renderProgress(
  percent: number,
  width: number,
  title?: string,
  subtext?: string,
): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const safeWidth = Number.isFinite(width) ? Math.max(1, width) : DEFAULT_WIDTH;
  const filled = Math.round((clamped / 100) * safeWidth);
  const empty = Math.max(0, safeWidth - filled);
  const bar = FILLED.repeat(filled) + EMPTY.repeat(empty);
  const pct = `${Math.round(clamped)}%`;
  const lines: string[] = [];
  if (title) lines.push(`<b>${escapeHtml(title)}</b>`);
  lines.push(`${bar}  ${pct}`);
  if (subtext) lines.push(`<i>${escapeHtml(subtext)}</i>`);
  return lines.join("\n");
}

const DESCRIPTION =
  "Creates a new progress bar message, auto-pins it (silent), and returns its message_id. " +
  "Use for percentage-based continuous tracking (e.g. 47%). " +
  "For discrete named steps with pass/fail status, use send_new_checklist instead. " +
  "Pass the returned message_id to update_progress to edit in-place. " +
  "At 100% update_progress auto-unpins the message. " +
  "Multiple concurrent progress bars are supported — each is tracked by its own message_id.";

export async function handleSendNewProgress({
  percent, title, subtext, width = DEFAULT_WIDTH, token, stale_after,
}: {
  percent: number;
  title?: string;
  subtext?: string;
  width?: number;
  token: number;
  stale_after?: number;
}) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  try {
    const topicTitle = title ? applyTopicToTitle(title) : undefined;
    const text = renderProgress(percent, width, topicTitle, subtext);
    const textErr = validateText(text);
    if (textErr) return toError(textErr);
    const stripped = text.replace(/<[^>]+>/g, '');
    const result = await routeOutboundMessage(chatId, stripped, {
      parse_mode: "HTML",
      richMessage: { html: text },
      _rawText: title ?? "",
    });
    await getApi().pinChatMessage(chatId, result.message_id, { disable_notification: true }).catch(() => {});

    // Arm stale-reminder timer if requested (opt-in).
    if (typeof stale_after === "number" && stale_after > 0) {
      armStaleTimer(result.message_id, sid, stale_after * 1000, title ?? "", percent);
    }

    return toResult({ message_id: result.message_id });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "send_new_progress",
    {
      description: DESCRIPTION,
      inputSchema: {
        percent: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe("Progress percentage (0–100)"),
        title: z
          .string()
          .optional()
          .describe("Optional bold heading. Omit or pass empty string to render bar only."),
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
        stale_after: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Optional. If set, fires a reminder into the session dequeue queue when this many " +
            "seconds elapse since the progress bar was last updated and it is still below 100%. " +
            "Opt-in — no timer is armed when this parameter is omitted.",
          ),
        token: TOKEN_SCHEMA,
      },
    },
    handleSendNewProgress,
  );
}
