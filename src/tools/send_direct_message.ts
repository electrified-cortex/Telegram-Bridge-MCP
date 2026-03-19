import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { getSession } from "../session-manager.js";
import { deliverDirectMessage } from "../session-queue.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Send a direct message to another session. The message is " +
  "delivered internally — it never appears in the Telegram chat. " +
  "All active sessions can DM each other. The target session receives the message " +
  "in its dequeue stream as a direct_message event.";

export function register(server: McpServer) {
  server.registerTool(
    "send_direct_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        identity: IDENTITY_SCHEMA,
        target_sid: z
          .number()
          .int()
          .positive()
          .describe("Session ID of the recipient"),
        text: z
          .string()
          .min(1)
          .describe("Message text to send"),
      },
    },
    ({ identity, target_sid, text }) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);

      if (_sid === target_sid) {
        return toError({
          code: "DM_SELF",
          message: "Cannot send a DM to yourself",
        });
      }

      const target = getSession(target_sid);
      if (!target) {
        return toError({
          code: "SESSION_NOT_FOUND",
          message: `Session ${target_sid} does not exist`,
        });
      }

      const delivered = deliverDirectMessage(_sid, target_sid, text);
      if (!delivered) {
        return toError({
          code: "DM_DELIVERY_FAILED",
          message: `Session ${target_sid} queue not available`,
        });
      }

      return toResult({ delivered: true, target_sid });
    },
  );
}
