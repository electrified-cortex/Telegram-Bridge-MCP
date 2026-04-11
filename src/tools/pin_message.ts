import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Pins or unpins a message in a chat. Requires the bot to have " +
  "appropriate admin rights. Pass unpin: true to unpin instead of pin. " +
  "Omit message_id with unpin: true to unpin the most recently pinned " +
  "message.";

export async function handlePinMessage({ message_id, disable_notification, unpin, token }: {
  message_id?: number;
  disable_notification?: boolean;
  unpin?: boolean;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  try {
    if (unpin) {
      const ok = message_id === undefined
        ? await getApi().unpinChatMessage(chatId)
        : await getApi().unpinChatMessage(chatId, message_id);
      return toResult({ ok, unpinned: true });
    }
    if (message_id === undefined) {
      return toError({ code: "MISSING_MESSAGE_ID" as const, message: "message_id is required when pinning. Pass the message_id returned by send or a prior message query." });
    }
    const ok = await getApi().pinChatMessage(chatId, message_id, {
      disable_notification,
    });
    return toResult({ ok });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "pin_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("ID of the message to pin/unpin. Required for pinning. For unpinning, omit to unpin the most recently pinned message."),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Pin without notifying members"),
      unpin: z
        .boolean()
        .optional()
        .describe("If true, unpin instead of pin"),
              token: TOKEN_SCHEMA,
},
    },
    handlePinMessage,
  );
}
