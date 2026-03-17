import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import {
  dequeueBatch, pendingCount, waitForEnqueue,
  type TimelineEvent,
} from "../message-store.js";
import { getActiveSession, setActiveSession, activeSessionCount } from "../session-manager.js";
import { getSessionQueue, getMessageOwner } from "../session-queue.js";

/** Auto-salute voice messages on dequeue so the user knows we received them. */
function ackVoice(event: TimelineEvent): void {
  if (event.from !== "user" || event.content.type !== "voice") return;
  ackVoiceMessage(event.id);
}

/** Strip _update and timestamp for the compact dequeue format. */
function compactEvent(event: TimelineEvent, sid: number): Record<string, unknown> {
  const { _update: _, timestamp: __, ...rest } = event;
  void sid; // reserved for future per-session metadata
  const result: Record<string, unknown> = rest;
  const replyTo = event.content.reply_to;
  const target = event.content.target;
  const isTargeted =
    (replyTo !== undefined && getMessageOwner(replyTo) > 0) ||
    (target !== undefined && getMessageOwner(target) > 0);
  result.routing = isTargeted ? "targeted" : "ambiguous";
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
  "with optional `pending` (count of remaining queued updates, when > 0). " +
  "When no update is available: returns `{ timed_out: true }` when a blocking wait expires (call again " +
  "immediately to keep the loop alive), or `{ empty: true }` for instant polls (timeout: 0). " +
  "Voice messages arrive pre-transcribed as { type: \"voice\", text: \"...\" }. " +
  "pending > 0 means more updates are queued — call again. " +
  "Two modes: omit timeout (default 300 s) to block up to 300 s for the next update; " +
  "pass timeout: 0 for an instant non-blocking poll (use only for startup drain loops). " +
  "Pass sid (from session_start result) when multiple sessions share the same server process — " +
  "this pins the queue to the correct session instead of relying on global active-session state. " +
  "Ensure session_start has been called.";

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
          .default(300)
          .describe("Seconds to block when queue is empty. Default 300 (5 min) blocks up to 300 s for the next update — optimized for agent listen loops. Pass 0 for an instant non-blocking poll (drain loops only). Max 300."),
        sid: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Session ID returned by session_start. Pass this when multiple sessions share the same server process to ensure this call reads from the correct session queue."),
      },
    },
    async ({ timeout, sid: explicitSid }, { signal }) => {
      // Multi-session safety: when >1 session is active, agents MUST pass
      // sid explicitly — the global getActiveSession() fallback is a race
      // condition that silently picks the wrong session.
      if (explicitSid === undefined && activeSessionCount() > 1) {
        return toError({
          code: "SID_REQUIRED" as const,
          message:
            `Multiple sessions are active (${activeSessionCount()}). ` +
            `Pass sid (from session_start) to identify your session.`,
        });
      }

      // Session-aware queue selection: explicit sid takes priority over global
      // active-session state (which is unreliable when multiple Copilot chat
      // instances share the same server process).
      const sid = explicitSid ?? getActiveSession();
      const sessionQueue = sid > 0 ? getSessionQueue(sid) : undefined;

      // Explicit sid with no queue means the session ended or never existed.
      if (explicitSid !== undefined && sid > 0 && !sessionQueue) {
        return toError({
          code: "SESSION_NOT_FOUND" as const,
          message:
            `No session queue for sid=${sid}. ` +
            `The session may have ended or was never started.`,
        });
      }

      // Keep active session in sync — set at the start AND re-set before
      // each return so the global is correct when the next tool call dispatches.
      // (Concurrent tool calls from other sessions can overwrite the global
      // during the long wait; re-syncing here restores it.)
      function resyncActiveSession(): void {
        if (explicitSid !== undefined) setActiveSession(explicitSid);
      }

      resyncActiveSession();

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
        resyncActiveSession();
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
          resyncActiveSession();
          return toResult(result);
        }
      }

      resyncActiveSession();
      return toResult({ timed_out: true, pending: pendingCountAny() });
    },
  );
}
