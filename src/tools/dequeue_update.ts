import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession } from "../session-manager.js";
import { getSessionQueue, getMessageOwner } from "../session-queue.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import {
  promoteDeferred,
  getActiveReminders,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
} from "../reminder-state.js";

/** Seconds an active reminder must be idle before it fires within dequeue_update. */
const REMINDER_IDLE_THRESHOLD_MS = 60_000;

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
  "token is always required — pass the session token returned by session_start.";

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
        token: TOKEN_SCHEMA,
      },
    },
    async ({ timeout, token }, { signal }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      const sessionQueue = getSessionQueue(sid);

      if (!sessionQueue) {
        return toError({
          code: "SESSION_NOT_FOUND" as const,
          message:
            `No session queue for sid=${sid}. ` +
            `The session may have ended or was never started.`,
        });
      }

      const sq = sessionQueue;

      // Keep active session in sync — set at the start AND re-set before
      // each return so the global is correct when the next tool call dispatches.
      // (Concurrent tool calls from other sessions can overwrite the global
      // during the long wait; re-syncing here restores it.)
      function resyncActiveSession(): void {
        setActiveSession(sid);
      }

      resyncActiveSession();

      // Record a heartbeat so the health-check can detect unresponsive sessions.
      if (sid > 0) touchSession(sid);

      function dequeueBatchAny(): TimelineEvent[] {
        return sq.dequeueBatch();
      }

      function pendingCountAny(): number {
        return sq.pendingCount();
      }

      function waitForEnqueueAny(): Promise<void> {
        return sq.waitForEnqueue();
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
      const reminderIdleStart = Date.now();
      while (Date.now() < deadline) {
        if (signal.aborted) break;

        // Promote any deferred reminders whose delay has elapsed.
        promoteDeferred(sid);

        const now = Date.now();
        const idleDuration = now - reminderIdleStart;
        const activeReminders = getActiveReminders(sid);

        // Fire active reminders after 60 s of idle (no real messages).
        if (idleDuration >= REMINDER_IDLE_THRESHOLD_MS && activeReminders.length > 0) {
          const fired = popActiveReminders(sid);
          resyncActiveSession();
          return toResult({ updates: fired.map(buildReminderEvent), pending: pendingCountAny() });
        }

        const remaining = deadline - now;
        if (remaining <= 0) break;

        // Wake up as soon as the earliest of: reminder idle threshold, next deferred promotion, or timeout.
        const timeToFireMs = activeReminders.length > 0
          ? Math.max(0, REMINDER_IDLE_THRESHOLD_MS - idleDuration)
          : Infinity;
        const deferredMs = getSoonestDeferredMs(sid);
        const waitMs = Math.min(remaining, timeToFireMs, deferredMs ?? Infinity);

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          waitForEnqueueAny(),
          new Promise<void>((r) => { timeoutHandle = setTimeout(r, Math.max(0, waitMs)); }),
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
