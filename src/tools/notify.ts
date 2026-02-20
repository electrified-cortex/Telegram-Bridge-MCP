import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";

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
    "Sends a formatted notification message to a chat. Handles severity styling (info/success/warning/error) automatically with emoji prefixes and bold titles. The most common agent tool — use for build results, progress updates, and status changes. Default parse_mode is MarkdownV2. Use HTML if your body content has heavy punctuation and escaping is inconvenient.",
    {
      title: z.string().describe("Short bold heading, e.g. \"Build Failed\""),
      body: z.string().optional().describe("Optional detail paragraph"),
      severity: z
        .enum(["info", "success", "warning", "error"])
        .default("info")
        .describe("Controls the emoji prefix"),
      parse_mode: z
        .enum(["HTML", "MarkdownV2"])
        .default("MarkdownV2")
        .describe("Text formatting mode for the body (and title bold)"),
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
        const titleFormatted = parse_mode === "HTML"
          ? `<b>${escapeHtml(title)}</b>`
          : `*${escapeMd(title)}*`;
        const lines = [`${prefix} ${titleFormatted}`];
        if (body?.trim()) lines.push("", body.trim());
        const text = lines.join("\n");

        const err = validateText(text);
        if (err) return toError(err);

        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode,
          disable_notification,
        });
        return toResult({ message_id: msg.message_id });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
