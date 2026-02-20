import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, filterAllowedUpdates, toResult, toError } from "../telegram.js";

/**
 * Long-polls for a callback_query update (inline button press).
 *
 * Because Telegram's getUpdates is used as a single long-poll call, the agent
 * simply awaits this tool and gets back the result once the user presses a
 * button — no polling loop needed on the caller side.
 *
 * Filtering behaviour:
 *  - All received updates advance the offset (nothing is skipped silently).
 *  - Only callback_query updates are inspected for the filter match.
 *  - Non-matching updates are still consumed so they don't block the queue.
 */
export function register(server: McpServer) {
  server.tool(
    "wait_for_callback_query",
    "Blocks (long-poll) until an inline button is pressed, then returns the callback data. Optionally filter by message_id. Returns { timed_out: true } if nobody responds within timeout_seconds. Use after send_confirmation for approval flows.",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("How long to wait for a button press (1–55 s)"),
      message_id: z
        .number()
        .int()
        .optional()
        .describe("Only accept callbacks on this specific message"),
    },
    async ({ timeout_seconds, message_id }) => {
      try {
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        // Always advance offset so future calls don't re-process these updates
        advanceOffset(updates);

        const allowed = filterAllowedUpdates(updates);
        const match = allowed.find((u) => {
          if (!u.callback_query) return false;
          if (
            message_id !== undefined &&
            u.callback_query.message?.message_id !== message_id
          )
            return false;
          return true;
        });

        if (!match?.callback_query) {
          return toResult({ timed_out: true });
        }

        const cq = match.callback_query;
        return toResult({
          timed_out: false,
          callback_query_id: cq.id,
          data: cq.data,
          message_id: cq.message?.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
