import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { listSessions } from "../session-manager.js";
import { deliverDirectMessage } from "../session-queue.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const SHUTDOWN_CLEANUP =
  "Action required: (1) finish current task, (2) delete stored session token from memory, " +
  "(3) call action(type: \"session/close\") to close cleanly, " +
  "(4) do NOT retry — session is being terminated.";

const BASE_WARNING =
  "⛔ Shutdown warning: session termination imminent. " +
  SHUTDOWN_CLEANUP;

const DESCRIPTION =
  "Send a pre-shutdown advisory DM to all other active sessions. " +
  "Use this before calling `shutdown` so workers have time to wrap up. " +
  "Does NOT shut down the server — call `shutdown` separately when ready. " +
  "Returns the count of sessions notified.";

export function handleNotifyShutdownWarning({ token, reason, wait_seconds }: {
  token: number;
  reason?: string;
  wait_seconds?: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const others = listSessions().filter(s => s.sid !== _sid);
  if (others.length === 0) {
    return toResult({ notified: 0, message: "No other sessions active" });
  }

  const parts: string[] = [BASE_WARNING];
  if (reason) parts.push(`Reason: ${reason}`);
  if (typeof wait_seconds === "number") {
    parts.push(`Shutdown in: ~${wait_seconds}s`);
  }
  const text = parts.join("\n");

  let notified = 0;
  for (const s of others) {
    if (deliverDirectMessage(_sid, s.sid, text)) notified++;
  }

  return toResult({ notified });
}

export function register(server: McpServer) {
  server.registerTool(
    "notify_shutdown_warning",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        reason: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional reason for the shutdown (e.g. \"code update\", \"config change\")"),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Optional estimated time in seconds before shutdown"),
      },
    },
    handleNotifyShutdownWarning,
  );
}
