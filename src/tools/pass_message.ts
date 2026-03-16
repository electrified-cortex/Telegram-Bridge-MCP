import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { SESSION_AUTH_SCHEMA, checkAuth } from "../session-auth.js";
import { getRoutingMode } from "../routing-mode.js";
import { passMessage } from "../session-queue.js";

const DESCRIPTION =
  "Pass an ambiguous message to the next session in cascade order. " +
  "Use this when you receive a message that isn't relevant to your " +
  "session's focus. Only works in cascade routing mode. The message " +
  "is forwarded to the next session in SID order; the last session " +
  "cannot pass.";

export function register(server: McpServer) {
  server.registerTool(
    "pass_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        ...SESSION_AUTH_SCHEMA,
        message_id: z
          .number()
          .int()
          .positive()
          .describe("ID of the message to pass to the next session"),
      },
    },
    ({ sid, pin, message_id }) => {
      const authErr = checkAuth(sid, pin);
      if (authErr) return authErr;

      if (getRoutingMode() !== "cascade") {
        return toError({
          code: "NOT_CASCADE_MODE",
          message: "pass_message is only available in cascade routing mode",
        });
      }

      const targetSid = passMessage(sid, message_id);
      if (targetSid === 0) {
        return toError({
          code: "PASS_FAILED",
          message:
            "Could not pass — either the message was not found, " +
            "or this is the last session in cascade order.",
        });
      }

      return toResult({ passed: true, forwarded_to: targetSid });
    },
  );
}
