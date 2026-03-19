import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { showTyping, cancelTyping } from "../typing-state.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Starts (or extends) a sustained background typing indicator that repeats " +
  "every 4 s until the timeout expires or a real message is sent. " +
  "Idempotent — safe to call multiple times; only one interval runs at a " +
  "time. Cancelled automatically when any message is sent. Default timeout " +
  "is 20 s. Pass cancel: true to immediately stop typing (replaces the old " +
  "cancel_typing tool). For a persistent in-chat visual placeholder that " +
  "survives message sends, use show_animation instead.";

export function register(server: McpServer) {
  server.registerTool(
    "show_typing",
    {
      description: DESCRIPTION,
      inputSchema: {
        timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(20)
        .describe("How long to keep the typing indicator alive (1–300 s, default 20). Calling show_typing again while active just extends the deadline."),
      cancel: z
        .boolean()
        .optional()
        .describe("If true, immediately stop the typing indicator instead of starting/extending it."),
              identity: IDENTITY_SCHEMA,
},
    },
    async ({ timeout_seconds, cancel, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      if (cancel) {
        const wasActive = cancelTyping();
        return toResult({ ok: true, cancelled: wasActive });
      }
      const started = await showTyping(timeout_seconds);
      return toResult({ ok: true, timeout_seconds, started });
    }
  );
}
