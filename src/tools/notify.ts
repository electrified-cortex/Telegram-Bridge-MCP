import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat } from "../telegram.js";

const SEVERITY_PREFIX: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

/**
 * Fire-and-forget styled notification. Handles formatting automatically so the
 * agent doesn't need to think about HTML or emoji conventions.
 */
export function register(server: McpServer) {
  server.tool(
    "notify",
    "Sends a formatted notification message to a chat. Handles severity styling (info/success/warning/error) automatically with emoji prefixes and HTML bold titles. The most common agent tool — use for build results, progress updates, and status changes.",
    {
      title: z.string().describe("Short bold heading, e.g. \"Build Failed\""),
      body: z.string().optional().describe("Optional detail paragraph"),
      severity: z
        .enum(["info", "success", "warning", "error"])
        .default("info")
        .describe("Controls the emoji prefix"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently (no phone notification)"),
    },
    async ({ title, body, severity, disable_notification }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const prefix = SEVERITY_PREFIX[severity];
        const lines = [`${prefix} <b>${title}</b>`];
        if (body?.trim()) lines.push("", body.trim());
        const text = lines.join("\n");

        const err = validateText(text);
        if (err) return toError(err);

        const msg = await getApi().sendMessage(chatId, text, {
          parse_mode: "HTML",
          disable_notification,
        });
        return toResult({ message_id: msg.message_id });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
