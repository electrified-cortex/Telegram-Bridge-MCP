import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../../telegram.js";
import { showTyping, cancelTyping } from "../../typing-state.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { maybeReplaceRecoveringAnimation } from "../../compaction-recovery.js";

const DESCRIPTION =
  "Starts (or extends) a sustained background typing indicator that repeats " +
  "every 4 s until the timeout expires or a real message is sent. " +
  "Idempotent — safe to call multiple times; only one interval runs at a " +
  "time. Cancelled automatically when any message is sent. Default timeout " +
  "is 20 s. Pass cancel: true to immediately stop typing (replaces the old " +
  "cancel_typing tool). For a persistent in-chat visual placeholder that " +
  "survives message sends, use show_animation instead.";

export async function handleShowTyping({ timeout_seconds = 20, cancel, token }: {
  timeout_seconds?: number;
  cancel?: boolean;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  if (cancel) {
    const wasActive = cancelTyping();
    return toResult({ cancelled: wasActive });
  }
  await maybeReplaceRecoveringAnimation(_sid);
  const started = await showTyping(timeout_seconds);
  return toResult({ timeout_seconds, started });
}

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
              token: TOKEN_SCHEMA,
},
    },
    handleShowTyping,
  );
}
