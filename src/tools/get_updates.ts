import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, resetOffset, toResult, toError } from "../telegram.js";

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
          ...(allowed_updates ? { allowed_updates: allowed_updates as any } : {}),
        });

        advanceOffset(updates);
        return toResult(updates);
      } catch (err) {
        return toError(err);
      }
    }
  );
}
