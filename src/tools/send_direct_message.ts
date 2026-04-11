import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { getSession } from "../session-manager.js";
import { deliverDirectMessage } from "../session-queue.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { DIGITS_ONLY } from "../utils/patterns.js";

const DESCRIPTION =
  "Send a direct message to another session. The message is " +
  "delivered internally — it never appears in the Telegram chat. " +
  "All active sessions can DM each other. The target session receives the message " +
  "in its dequeue stream as a direct_message event.";

export function handleSendDirectMessage({ token, target_sid, text }: { token: number; target_sid: number; text: string }) {
  const _sid = requireAuth(token);
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
      message: `Session ${target_sid} does not exist. Call action(type: 'session/list') to see active sessions.`,
    });
  }

  const delivered = deliverDirectMessage(_sid, target_sid, text);
  if (!delivered) {
    return toError({
      code: "DM_DELIVERY_FAILED",
      message: `Session ${target_sid} queue not available. The session may have just closed — call action(type: 'session/list') to confirm.`,
    });
  }

  return toResult({ delivered: true, target_sid });
}

export function register(server: McpServer) {
  server.registerTool(
    "send_direct_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        target_sid: z
          .preprocess(
            (v) => typeof v === "string" && DIGITS_ONLY.test(v) ? parseInt(v, 10) : v,
            z.number().int().positive(),
          )
          .describe("Session ID of the recipient"),
        text: z
          .string()
          .min(1)
          .describe("Message text to send"),
      },
    },
    handleSendDirectMessage,
  );
}
