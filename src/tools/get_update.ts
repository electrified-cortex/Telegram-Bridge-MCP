import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, filterAllowedUpdates, toResult, toError, DEFAULT_ALLOWED_UPDATES } from "../telegram.js";
import { drainN, bufferSize } from "../update-buffer.js";
import { sanitizeUpdates } from "../update-sanitizer.js";

export function register(server: McpServer) {
  server.tool(
    "get_update",
    "**Default tool for receiving messages.** Returns up to `max` pending updates (default 1) from the local buffer, " +
    "then fetches from Telegram if more are needed. " +
    "Always returns `remaining` — the number of updates still buffered after this call. " +
    "Always check `remaining` after each call: if > 0, call again before blocking.\n\n" +
    "Standard loop:\n" +
    "  1. Call `get_update()` — handle the update if present.\n" +
    "  2. If `remaining > 0`, call `get_update()` again immediately.\n" +
    "  3. When `updates` is empty and `remaining` is 0, call `wait_for_message` to block for the next incoming message.\n\n" +
    "Use `get_updates` (plural) only if you are prepared to store and respond to every update it returns — it returns all pending updates at once with no `remaining` signal.",
    {
      max: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(1)
        .describe("Maximum number of updates to return. Default 1 — process one at a time and check `remaining` for more."),
      allowed_updates: z
        .array(z.string())
        .optional()
        .describe("Filter by update types, e.g. [\"message\", \"callback_query\"]. Omit to receive all."),
    },
    async ({ max, allowed_updates }) => {
      try {
        // Step 1: take up to `max` from the local buffer first
        const buffered = filterAllowedUpdates(drainN(max));

        let fresh: Awaited<ReturnType<typeof filterAllowedUpdates>> = [];
        if (buffered.length < max) {
          // Step 2: fetch from Telegram to fill up to max
          const fetched = await getApi().getUpdates({
            offset: getOffset(),
            limit: max - buffered.length,
            timeout: 0,
            allowed_updates: (allowed_updates ?? DEFAULT_ALLOWED_UPDATES) as any,
          });
          advanceOffset(fetched);
          fresh = filterAllowedUpdates(fetched);
        }

        const batch = [...buffered, ...fresh];
        const remaining = bufferSize(); // items still waiting after this drain

        if (batch.length === 0) {
          return toResult({ updates: [], remaining, hint: remaining > 0 ? "More updates buffered — call get_update again." : "Buffer empty — call wait_for_message to block for the next message." });
        }

        const sanitized = await sanitizeUpdates(batch);
        return toResult({
          updates: sanitized,
          remaining,
          ...(remaining > 0 ? { hint: `${remaining} more update${remaining === 1 ? "" : "s"} buffered — call get_update again.` } : {}),
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
