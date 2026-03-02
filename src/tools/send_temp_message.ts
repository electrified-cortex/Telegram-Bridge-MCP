import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, resolveChat, toResult, toError, validateText } from "../telegram.js";
import { setPendingTemp } from "../temp-message.js";

export function register(server: McpServer) {
  server.tool(
    "send_temp_message",
    "Sends a temporary placeholder message (e.g. 'Thinking…', 'Analyzing files…') that is automatically deleted when any subsequent outbound tool sends a real response, or after the TTL expires. " +
    "Use immediately before a long operation to keep the user informed without cluttering the chat. " +
    "Returns as soon as the message is sent — does not block. " +
    "No action is needed to clean it up; the next send_message / notify / ask / choose / etc. call handles deletion automatically.",
    {
      text: z
        .string()
        .describe("Short status text shown to the user, e.g. 'Thinking…' or 'Fetching data…'"),
      ttl_seconds: z
        .number()
        .int()
        .min(5)
        .max(300)
        .default(30)
        .describe("Delete after this many seconds if no subsequent tool clears it first (default 30)"),
    },
    async ({ text, ttl_seconds }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      const textErr = validateText(text);
      if (textErr) return toError(textErr);

      try {
        const msg = await getApi().sendMessage(chatId, text);
        setPendingTemp(chatId, msg.message_id, ttl_seconds);
        return toResult({ ok: true, ttl_seconds });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
