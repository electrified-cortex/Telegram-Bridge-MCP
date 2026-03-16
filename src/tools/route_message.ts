import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { SESSION_AUTH_SCHEMA, checkAuth } from "../session-auth.js";
import { getRoutingMode, getGovernorSid } from "../routing-mode.js";
import { getSession } from "../session-manager.js";
import { routeMessage } from "../session-queue.js";

const DESCRIPTION =
  "Route an ambiguous message to a specific session. Only the " +
  "governor session can use this tool. The governor receives all " +
  "ambiguous messages and delegates them to the appropriate " +
  "session based on topic relevance.";

export function register(server: McpServer) {
  server.registerTool(
    "route_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        ...SESSION_AUTH_SCHEMA,
        message_id: z
          .number()
          .int()
          .positive()
          .describe("ID of the message to route"),
        target_sid: z
          .number()
          .int()
          .positive()
          .describe("Session ID to route the message to"),
      },
    },
    ({ sid, pin, message_id, target_sid }) => {
      const authErr = checkAuth(sid, pin);
      if (authErr) return authErr;

      if (getRoutingMode() !== "governor") {
        return toError({
          code: "NOT_GOVERNOR_MODE",
          message: "route_message is only available in governor routing mode",
        });
      }

      if (sid !== getGovernorSid()) {
        return toError({
          code: "NOT_GOVERNOR",
          message: "Only the governor session can route messages",
        });
      }

      if (!getSession(target_sid)) {
        return toError({
          code: "SESSION_NOT_FOUND",
          message: `Session ${target_sid} does not exist`,
        });
      }

      const delivered = routeMessage(message_id, target_sid);
      if (!delivered) {
        return toError({
          code: "ROUTE_FAILED",
          message: "Could not route — message not found or target queue unavailable",
        });
      }

      return toResult({ routed: true, target_sid });
    },
  );
}
