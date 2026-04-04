import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { getGovernorSid } from "../routing-mode.js";
import { getSession } from "../session-manager.js";
import { routeMessage } from "../session-queue.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { DIGITS_ONLY } from "../utils/patterns.js";

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
        token: TOKEN_SCHEMA,
        message_id: z
          .number()
          .int()
          .positive()
          .describe("ID of the message to route"),
        target_sid: z
          .preprocess(
            (v) => typeof v === "string" && DIGITS_ONLY.test(v) ? parseInt(v, 10) : v,
            z.number().int().positive(),
          )
          .describe("Session ID to route the message to"),
      },
    },
    ({ token, message_id, target_sid }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      if (getGovernorSid() === 0) {
        return toError({
          code: "NOT_GOVERNOR_MODE",
          message: "route_message is only available when a governor session is active",
        });
      }

      if (_sid !== getGovernorSid()) {
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

      const delivered = routeMessage(message_id, target_sid, _sid);
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
