import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Update } from "grammy/types";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, filterAllowedUpdates, hijackNotifyAgent, fireHijackNotification, toResult, toError, DEFAULT_ALLOWED_UPDATES } from "../telegram.js";
import { drainN, bufferSize } from "../update-buffer.js";
import { sanitizeUpdates } from "../update-sanitizer.js";

export function register(server: McpServer) {
  server.registerTool(
    "get_update",
    {
      description: "**Default tool for receiving messages.** Returns up to `max` pending updates (default 1) from the local buffer, " +
    "then fetches from Telegram if more are needed. " +
    "Always returns `remaining` — the number of updates still buffered after this call. " +
    "Always check `remaining` after each call: if > 0, call again before blocking.\n\n" +
    "Standard loop:\n" +
    "  1. Call `get_update()` — handle the update if present.\n" +
    "  2. If `remaining > 0`, call `get_update()` again immediately.\n" +
    "  3. When `updates` is empty and `remaining` is 0, call `wait_for_message` to block for the next incoming message.\n\n" +
    "Use `get_updates` (plural) only if you are prepared to store and respond to every update it returns — it returns all pending updates at once with no `remaining` signal.",
      inputSchema: {
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
    },
    async ({ max, allowed_updates }) => {
      try {
        // Step 1: take up to `max` from the local buffer first
        const buffered = filterAllowedUpdates(drainN(max));

        let fresh: Update[] = [];
        if (buffered.length < max) {
          // Step 2: fetch from Telegram to fill up to max
          const fetched = await getApi().getUpdates({
            offset: getOffset(),
            limit: max - buffered.length,
            timeout: 0,
            allowed_updates: (allowed_updates ?? DEFAULT_ALLOWED_UPDATES) as ReadonlyArray<Exclude<keyof Update, "update_id">>,
          });
          const hijackWarning = advanceOffset(fetched);
          if (hijackWarning && hijackNotifyAgent())
            return toResult({ hijack_warning: hijackWarning, updates: [], remaining: bufferSize() });
          fresh = filterAllowedUpdates(fetched);
        }

        const batch = [...buffered, ...fresh];
        const remaining = bufferSize(); // items still waiting after this drain

        if (batch.length === 0) {
          const hint = remaining > 0
            ? "More updates buffered — call get_update again."
            : "Buffer empty — call wait_for_message to block for the next message.";
          return toResult({ updates: [], remaining, hint });
        }

        const sanitized = await sanitizeUpdates(batch);
        return toResult({
          updates: sanitized,
          remaining,
          ...(remaining > 0 ? { hint: `${remaining} more update${remaining === 1 ? "" : "s"} buffered — call get_update again.` } : {}),
        });
      } catch (err) {
        // 409 Conflict = another instance is polling — fire same hijack channels as gap detection
        if (err instanceof Error && "error_code" in err && (err as { error_code: number }).error_code === 409) {
          const msg =
            "⚠️ Telegram 409 Conflict — another getUpdates call is already active for this bot token. " +
            "Ensure only one MCP instance is running against this bot token.";
          fireHijackNotification(msg);
          if (hijackNotifyAgent())
            return toResult({ hijack_warning: msg, updates: [], remaining: bufferSize() });
        }
        return toError(err);
      }
    }
  );
}
