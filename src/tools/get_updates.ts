import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, resetOffset, filterAllowedUpdates, toResult, toError, DEFAULT_ALLOWED_UPDATES } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";

export function register(server: McpServer) {
  server.tool(
    "get_updates",
    "Retrieves pending Telegram updates using the server's internal offset (polling pattern). Call repeatedly to consume the update queue. Advances the offset automatically so previously seen updates are never re-delivered.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Max number of updates to return (1–100)"),
      timeout: z
        .number()
        .int()
        .min(0)
        .max(55)
        .default(0)
        .describe(
          "Long-poll timeout in seconds. 0 = short poll (instant). Up to 55 for long polling."
        ),
      allowed_updates: z
        .array(z.string())
        .optional()
        .describe(
          "Filter by update types, e.g. [\"message\", \"callback_query\"]. Omit to receive all."
        ),
      reset_offset: z
        .boolean()
        .optional()
        .describe("If true, resets the stored offset to 0 before fetching"),
    },
    async ({ limit, timeout, allowed_updates, reset_offset }) => {
      try {
        if (reset_offset) resetOffset();

        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit,
          timeout,
          allowed_updates: (allowed_updates ?? DEFAULT_ALLOWED_UPDATES) as any,
        });

        advanceOffset(updates);
        const allowed = filterAllowedUpdates(updates);
        const sanitized = await Promise.all(allowed.map(async (u) => {
          if (u.message?.voice) {
            const text = await transcribeWithIndicator(u.message.voice.file_id).catch((e) => `[transcription failed: ${e.message}]`);
            return { type: "message", message_id: u.message.message_id, text, voice: true };
          }
          if (u.message?.text) return { type: "message", message_id: u.message.message_id, text: u.message.text };
          if (u.callback_query) return { type: "callback_query", callback_query_id: u.callback_query.id, data: u.callback_query.data, message_id: u.callback_query.message?.message_id };
          return { type: "other" };
        }));
        return toResult(sanitized);
      } catch (err) {
        return toError(err);
      }
    }
  );
}
