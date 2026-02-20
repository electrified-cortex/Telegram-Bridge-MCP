import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, filterAllowedUpdates, toResult, toError } from "../telegram.js";

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
    "Blocks (long-poll) until a text message is received, then returns it. Optionally filter by sender user_id. Returns { timed_out: true } on expiry. Use for open-ended questions where the user types a reply.",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("How long to wait for a message (1–55 s)"),
      user_id: z
        .number()
        .int()
        .optional()
        .describe("Only accept messages from this Telegram user ID"),
    },
    async ({ timeout_seconds, user_id }) => {
      try {
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        advanceOffset(updates);

        const allowed = filterAllowedUpdates(updates);
        const match = allowed.find((u) => {
          if (!u.message?.text) return false;
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
          text: msg.text,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
