import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, ackVoiceMessage } from "../telegram.js";
import {
  dequeue, pendingCount, waitForEnqueue,
  type TimelineEvent,
} from "../message-store.js";

/** Auto-salute voice messages on dequeue so the user knows we received them. */
function ackVoice(event: TimelineEvent): void {
  if (event.from !== "user" || event.content.type !== "voice") return;
  ackVoiceMessage(event.id);
}

/** Strip _update and timestamp for the compact dequeue format. */
function compactEvent(event: TimelineEvent): Record<string, unknown> {
  const { _update: _, timestamp: __, ...rest } = event;
  return rest;
}

const DESCRIPTION =
  "Consume the next update from the queue. Response lane (reactions, callbacks) " +
  "drains before message lane (new messages, commands, media). " +
  "Voice messages arrive pre-transcribed as { type: \"voice\", text: \"...\" }. " +
  "pending > 0 means more updates are queued — call again before blocking. " +
  "Returns compact format: { id, event, from, content }. " +
  "Two modes: omit timeout (default 60 s) to block until an update arrives; " +
  "pass timeout: 0 for an instant non-blocking poll (use only for startup drain loops).";

export function register(server: McpServer) {
  server.registerTool(
    "dequeue_update",
    {
      description: DESCRIPTION,
      inputSchema: {
        timeout: z
          .number()
          .int()
          .min(0)
          .max(300)
          .default(60)
          .describe("Seconds to block when queue is empty. Default 60 blocks until an update arrives (normal loop). Pass 0 for an instant non-blocking poll (drain loops only). Max 300 (5 min)."),
      },
    },
    async ({ timeout }) => {
      // Try immediate dequeue
      let event = dequeue();
      if (event) {
        ackVoice(event);
        const pending = pendingCount();
        const result = compactEvent(event);
        if (pending > 0) result.pending = pending;
        return toResult(result);
      }

      if (timeout === 0) {
        return toResult({ empty: true, pending: pendingCount() });
      }

      // Block until something arrives or timeout expires
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        await Promise.race([
          waitForEnqueue(),
          new Promise<void>((r) => setTimeout(r, remaining)),
        ]);

        event = dequeue();
        if (event) {
          ackVoice(event);
          const pending = pendingCount();
          const result = compactEvent(event);
          if (pending > 0) result.pending = pending;
          return toResult(result);
        }
      }

      return toResult({ empty: true, pending: pendingCount() });
    },
  );
}
