import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, toResult, toError } from "../telegram.js";

/**
 * Long-polls for the next text message in a chat.
 *
 * Useful for free-form responses after the agent has asked an open question.
 * All received updates advance the offset, so non-message updates are
 * consumed cleanly from the queue.
 */
export function register(server: McpServer) {
  server.tool(
    "wait_for_message",
    "Blocks (long-poll) until a text message is received, then returns it. Optionally filter by chat_id or sender user_id. Returns { timed_out: true } on expiry. Use for open-ended questions where the user types a reply.",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("How long to wait for a message (1–55 s)"),
      chat_id: z
        .string()
        .optional()
        .describe("Only accept messages from this chat"),
      user_id: z
        .number()
        .int()
        .optional()
        .describe("Only accept messages from this Telegram user ID"),
    },
    async ({ timeout_seconds, chat_id, user_id }) => {
      try {
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        advanceOffset(updates);

        const match = updates.find((u) => {
          if (!u.message?.text) return false;
          if (chat_id && String(u.message.chat.id) !== chat_id) return false;
          if (user_id !== undefined && u.message.from?.id !== user_id)
            return false;
          return true;
        });

        if (!match?.message) {
          return toResult({ timed_out: true });
        }

        const msg = match.message;
        return toResult({
          timed_out: false,
          message_id: msg.message_id,
          chat_id: msg.chat.id,
          text: msg.text,
          from: msg.from
            ? {
                id: msg.from.id,
                username: msg.from.username,
                first_name: msg.from.first_name,
              }
            : null,
          date: msg.date,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
