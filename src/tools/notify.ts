import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";

const SEVERITY_PREFIX: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

const MD_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
function escapeMd(s: string) { return s.replace(MD_SPECIAL, "\\$&"); }
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fire-and-forget styled notification. Handles formatting automatically so the
 * agent doesn't need to think about HTML or emoji conventions.
 */
export function register(server: McpServer) {
  server.tool(
    "notify",
    "Sends a formatted notification message to a chat. Handles severity styling (info/success/warning/error) automatically with emoji prefixes and bold titles. The most common agent tool — use for build results, progress updates, and status changes. Default parse_mode is Markdown — write standard Markdown in the body and it is auto-converted, no escaping needed.",
    {
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
    },
    async ({ title, body, severity, parse_mode, disable_notification }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const prefix = SEVERITY_PREFIX[severity];
        const useV2 = parse_mode === "Markdown" || parse_mode === "MarkdownV2";
        const titleFormatted = useV2
          ? `*${escapeMd(title)}*`
          : `<b>${escapeHtml(title)}</b>`;
        const lines = [`${prefix} ${titleFormatted}`];
        if (body?.trim()) {
          const bodyText = parse_mode === "Markdown" ? markdownToV2(body.trim()) : body.trim();
          lines.push("", bodyText);
        }
        const text = lines.join("\n");
        const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;

        const err = validateText(text);
        if (err) return toError(err);

        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode: finalMode,
          disable_notification,
        });
        return toResult({ message_id: msg.message_id });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
