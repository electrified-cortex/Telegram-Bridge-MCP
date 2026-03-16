import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";
import { markdownToV2, escapeV2, escapeHtml } from "../markdown.js";
import { applyTopicToTitle } from "../topic-state.js";

const SEVERITY_PREFIX: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "⛔",
};

const DESCRIPTION =
  "Sends a formatted notification message to a chat. Handles severity " +
  "styling (info/success/warning/error) automatically with emoji prefixes " +
  "and bold titles. Use for structured status messages (build results, " +
  "process events, errors). For conversational replies or long explanations, " +
  "use send_text instead. Default parse_mode is Markdown " +
  "— write standard Markdown in the body and it is auto-converted, no " +
  "escaping needed. " +
  "Ensure session_start has been called.";

export function register(server: McpServer) {
  server.registerTool(
    "notify",
    {
      description: DESCRIPTION,
      inputSchema: {
        title: z.string().describe("Short bold heading, e.g. \"Build Failed\""),
      body: z.string().optional().describe("Optional detail paragraph"),
      severity: z
        .enum(["info", "success", "warning", "error"])
        .default("info")
        .describe("Controls the emoji prefix"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently (no phone notification)"),
      reply_to_message_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Reply to this message ID — shows quoted message above the notification"),
      },
    },
    async ({ title, body, severity, parse_mode, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const prefix = SEVERITY_PREFIX[severity];
        const useV2 = parse_mode === "Markdown" || parse_mode === "MarkdownV2";
        const topicTitle = applyTopicToTitle(title);
        const titleFormatted = useV2
          ? `*${escapeV2(topicTitle)}*`
          : `<b>${escapeHtml(topicTitle)}</b>`;
        const lines = [`${prefix} ${titleFormatted}`];
        if (body?.trim()) {
          const bodyText = parse_mode === "Markdown" ? markdownToV2(body.trim()) : body.trim();
          lines.push("", bodyText);
        }
        const text = lines.join("\n");
        const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;

        const err = validateText(text);
        if (err) return toError(err);

        const rawText = `${title}${body ? "\n" + body : ""}`;

        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode: finalMode,
          disable_notification,
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
          _rawText: rawText,
        } as Record<string, unknown>);
        return toResult({ message_id: msg.message_id });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
