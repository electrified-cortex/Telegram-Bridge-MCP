import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { showTyping } from "../typing-state.js";

/**
 * Idempotent typing indicator.
 *
 * Starts the interval if not already running. If already running, extends the
 * deadline instead of spawning a second interval. Auto-cancelled when any real
 * message is sent (sendMessage, sendPhoto, etc. all call cancelTyping()).
 */
export function register(server: McpServer) {
  server.tool(
    "show_typing",
    "Starts (or extends) a sustained background typing indicator that repeats every 4 s until the timeout expires or a real message is sent. Idempotent — safe to call multiple times; only one interval runs at a time. Cancelled automatically when any message is sent. Default timeout is 20 s.",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(20)
        .describe("How long to keep the typing indicator alive (1–300 s, default 20). Calling show_typing again while active just extends the deadline."),
    },
    async ({ timeout_seconds }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const started = await showTyping(timeout_seconds);
      return toResult({ ok: true, timeout_seconds, started });
    }
  );
}
