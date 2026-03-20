import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { listSessions } from "../session-manager.js";
import { deliverDirectMessage } from "../session-queue.js";
import { RESTART_GUIDANCE } from "../restart-guidance.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const BASE_WARNING =
  "⛔ Shutdown warning: the server is restarting soon. " +
  "Complete any in-progress work. " + RESTART_GUIDANCE;

const DESCRIPTION =
  "Send a pre-shutdown advisory DM to all other active sessions. " +
  "Use this before calling `shutdown` so workers have time to wrap up. " +
  "Does NOT shut down the server — call `shutdown` separately when ready. " +
  "Returns the count of sessions notified.";

export function register(server: McpServer) {
  server.registerTool(
    "notify_shutdown_warning",
    {
      description: DESCRIPTION,
      inputSchema: {
        identity: IDENTITY_SCHEMA,
        reason: z
          .string()
          .min(1)
          .optional()
          .describe("Optional reason for the restart (e.g. \"code update\", \"config change\")"),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Optional estimated wait time in seconds before restart"),
      },
    },
    ({ identity, reason, wait_seconds }) => {
      const callerSid = requireAuth(identity);
      if (typeof callerSid !== "number") return toError(callerSid);

      const others = listSessions().filter(s => s.sid !== callerSid);
      if (others.length === 0) {
        return toResult({ notified: 0, message: "No other sessions active" });
      }

      const parts: string[] = [BASE_WARNING];
      if (reason) parts.push(`Reason: ${reason}`);
      if (typeof wait_seconds === "number") {
        parts.push(`Estimated restart time: ~${wait_seconds}s`);
      }
      const text = parts.join("\n");

      let notified = 0;
      for (const s of others) {
        if (deliverDirectMessage(callerSid, s.sid, text)) notified++;
      }

      return toResult({ notified });
    },
  );
}
