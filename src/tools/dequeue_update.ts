import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, ackVoiceMessage } from "../telegram.js";
import {
  dequeueBatch, pendingCount, waitForEnqueue,
  type TimelineEvent,
} from "../message-store.js";
import { getActiveSession } from "../session-manager.js";
import { getSessionQueue, popCascadePassDeadline } from "../session-queue.js";
import { getRoutingMode } from "../routing-mode.js";

/** Auto-salute voice messages on dequeue so the user knows we received them. */
function ackVoice(event: TimelineEvent): void {
  if (event.from !== "user" || event.content.type !== "voice") return;
  ackVoiceMessage(event.id);
}

/** Strip _update and timestamp for the compact dequeue format. */
function compactEvent(event: TimelineEvent, sid: number): Record<string, unknown> {
  const { _update: _, timestamp: __, ...rest } = event;
  const result: Record<string, unknown> = rest;
  if (sid > 0 && getRoutingMode() === "cascade") {
    const deadline = popCascadePassDeadline(sid, event.id);
    if (deadline !== undefined) result.pass_by = new Date(deadline).toISOString();
  }
  return result;
}

/** Compact a batch of events for the response. */
function compactBatch(events: TimelineEvent[], sid: number): Record<string, unknown>[] {
  return events.map(e => compactEvent(e, sid));
}

const DESCRIPTION =
  "Consume queued updates in a single batch. Non-content events (reactions, " +
  "callbacks) are drained first, then up to one content event (user message " +
  "with text, media, or voice) is appended. Returns `{ updates: [{ id, event, from, content }, ...] }` " +
  "with optional `pending` (count of remaining queued updates, when > 0), or `{ empty: true }` on timeout. " +
  "Voice messages arrive pre-transcribed as { type: \"voice\", text: \"...\" }. " +
  "pending > 0 means more updates are queued — call again. " +
  "Two modes: omit timeout (default 60 s) to block until an update arrives; " +
  "pass timeout: 0 for an instant non-blocking poll (use only for startup drain loops). " +
  "Requires an active session — call session_start once before using this tool.";

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
    async ({ timeout }, { signal }) => {
      // Session-aware queue selection: use session queue when active,
      // fall back to global queue for backward compat (sid 0).
      const sid = getActiveSession();
      const sessionQueue = sid > 0 ? getSessionQueue(sid) : undefined;

      function dequeueBatchAny(): TimelineEvent[] {
        if (sessionQueue) {
          const items = sessionQueue.dequeueBatch();
          // Session queue stores raw TimelineEvent (not QueueItem)
          return items;
        }
        return dequeueBatch();
      }

      function pendingCountAny(): number {
        return sessionQueue ? sessionQueue.pendingCount() : pendingCount();
      }

      function waitForEnqueueAny(): Promise<void> {
        return sessionQueue ? sessionQueue.waitForEnqueue() : waitForEnqueue();
      }

      // Try immediate batch dequeue
      let batch = dequeueBatchAny();
      if (batch.length > 0) {
        for (const evt of batch) ackVoice(evt);
        const pending = pendingCountAny();
        const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
        if (pending > 0) result.pending = pending;
        return toResult(result);
      }

      if (timeout === 0) {
        return toResult({ empty: true, pending: pendingCountAny() });
      }

      // Block until something arrives or timeout expires
      const deadline = Date.now() + timeout * 1000;
      const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });
      while (Date.now() < deadline) {
        if (signal.aborted) break;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          waitForEnqueueAny(),
          new Promise<void>((r) => { timeoutHandle = setTimeout(r, remaining); }),
          abortPromise,
        ]);
        clearTimeout(timeoutHandle);

        batch = dequeueBatchAny();
        if (batch.length > 0) {
          for (const evt of batch) ackVoice(evt);
          const pending = pendingCountAny();
          const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
          if (pending > 0) result.pending = pending;
          return toResult(result);
        }
      }

      return toResult({ empty: true, pending: pendingCountAny() });
    },
  );
}
