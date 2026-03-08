import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Update } from "grammy/types";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, resetOffset, filterAllowedUpdates, hijackNotifyAgent, fireHijackNotification, toResult, toError, DEFAULT_ALLOWED_UPDATES } from "../telegram.js";
import { drainBuffer } from "../update-buffer.js";
import { sanitizeUpdates } from "../update-sanitizer.js";

export function register(server: McpServer) {
  server.registerTool(
    "get_updates",
    {
      description: "Retrieves all pending Telegram updates in bulk. " +
    "**Only use this tool when you are prepared to store and respond to every update it returns.** " +
    "It provides no `remaining` signal — if you process only the first update and move on, the rest are silently dropped. " +
    "For normal sequential message handling, use `get_update` (singular) instead. " +
    "Appropriate uses: one-time startup drain (discard all), bulk session replay, or explicit debugging.",
      inputSchema: {
        limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Max number of updates to return (1–100)"),
      timeout_seconds: z
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
    },
    async ({ limit, timeout_seconds, allowed_updates, reset_offset }) => {
      if (reset_offset) resetOffset();

      // Drain buffer before try — so catch can still return these if Telegram throws.
      const buffered = drainBuffer();
      const filteredBuffered = filterAllowedUpdates(buffered);

      try {
        // Only fetch from Telegram if buffer didn't already satisfy the limit.
        let fresh: typeof buffered = [];
        if (filteredBuffered.length < limit) {
          const fetched = await getApi().getUpdates({
            offset: getOffset(),
            limit: limit - filteredBuffered.length,
            timeout: timeout_seconds,
            allowed_updates: (allowed_updates ?? DEFAULT_ALLOWED_UPDATES) as ReadonlyArray<Exclude<keyof Update, "update_id">>,
          });
          const hijackWarning = advanceOffset(fetched);
          if (hijackWarning && hijackNotifyAgent()) {
            const updates = [...filteredBuffered, ...filterAllowedUpdates(fetched)];
            const sanitized = updates.length > 0 ? await sanitizeUpdates(updates) : [];
            return toResult({ hijack_warning: hijackWarning, updates: sanitized });
          }
          fresh = filterAllowedUpdates(fetched);
        }

        const allUpdates = [...filteredBuffered, ...fresh];
        const sanitized = await sanitizeUpdates(allUpdates);
        return toResult(sanitized);
      } catch (err) {
        // 409 Conflict = another instance is polling — fire same hijack channels as gap detection
        if (err instanceof Error && "error_code" in err && (err as { error_code: number }).error_code === 409) {
          const msg =
            "⚠️ Telegram 409 Conflict — another getUpdates call is already active for this bot token. " +
            "Ensure only one MCP instance is running against this bot token.";
          fireHijackNotification(msg);
          if (hijackNotifyAgent()) {
            // filteredBuffered was drained before the try — return it so no updates are lost
            const sanitized = filteredBuffered.length > 0 ? await sanitizeUpdates(filteredBuffered) : [];
            return toResult({ hijack_warning: msg, updates: sanitized });
          }
        }
        return toError(err);
      }
    }
  );
}
