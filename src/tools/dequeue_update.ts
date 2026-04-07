import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault } from "../session-manager.js";
import { getSessionQueue, getMessageOwner } from "../session-queue.js";
import { TOKEN_SCHEMA, consumeTokenStringHint } from "./identity-schema.js";
import {
  promoteDeferred,
  getActiveReminders,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
} from "../reminder-state.js";

/** Defensive clamp for a single setTimeout call, kept below Node.js's ~2^31-1 ms overflow limit. */
const MAX_SET_TIMEOUT_MS = 2_000_000_000;

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
  "Consume queued updates. Non-content events drain first, then up to one content event (text, media, voice) is appended. " +
  "Returns: `{ updates, pending? }` with data; `{ timed_out: true }` on blocking-wait expiry (call again immediately); " +
  "`{ empty: true }` for instant polls (timeout: 0); " +
  "`{ error: \"session_closed\", message }` (isError: false) when the session queue is gone — stop looping. " +
  "pending > 0 → call again. Omit timeout to use session default (set_dequeue_default, fallback 300 s); max explicit: 300 s. " +
  "Call `help(topic: 'dequeue_update')` for details.";

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
          .optional()
          .describe("Seconds to block when queue is empty. Omit to use your session default (set via set_dequeue_default); server fallback is 300 s. Pass 0 for an instant non-blocking poll (drain loops only). Values above the session default require force: true or set_dequeue_default. Max 300 s — use set_dequeue_default to configure persistent agents."),
        force: z
          .boolean()
          .default(false)
          .describe("Pass true to allow a one-time override when timeout exceeds your current session default. Only applies to values ≤ 300 s (the hard cap on timeout). To wait longer than 300 s by default, use set_dequeue_default instead."),
        token: TOKEN_SCHEMA,
      },
    },
    async ({ timeout, force, token }, { signal }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      // Capture the token-string hint now (before any early returns consume it).
      const tokenHint = consumeTokenStringHint();

      // Gate: reject timeout values above the session default unless force is set
      const sessionDefault = getDequeueDefault(sid);
      const effectiveTimeout = timeout ?? sessionDefault;
      if (timeout !== undefined && timeout > sessionDefault && !force) {
        return toResult({
          error: "TIMEOUT_EXCEEDS_DEFAULT",
          message: `timeout ${timeout} exceeds your current default of ${sessionDefault}s.`,
          hint: `Pass force: true for a one-time override, or call set_dequeue_default(${timeout}) to raise your default.`,
        });
      }

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
        if (tokenHint) result.hint = tokenHint;
        resyncActiveSession();
        return toResult(result);
      }

      if (effectiveTimeout === 0) {
        const emptyResult: Record<string, unknown> = { empty: true, pending: pendingCountAny() };
        if (tokenHint) emptyResult.hint = tokenHint;
        return toResult(emptyResult);
      }

      // Block until something arrives or timeout expires
      const deadline = Date.now() + effectiveTimeout * 1000;
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
          const reminderResult: Record<string, unknown> = { updates: fired.map(buildReminderEvent), pending: pendingCountAny() };
          if (tokenHint) reminderResult.hint = tokenHint;
          return toResult(reminderResult);
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
          new Promise<void>((r) => { timeoutHandle = setTimeout(r, Math.min(Math.max(0, waitMs), MAX_SET_TIMEOUT_MS)); }),
          abortPromise,
        ]);
        clearTimeout(timeoutHandle);

        batch = dequeueBatchAny();
        if (batch.length > 0) {
          for (const evt of batch) ackVoice(evt);
          const pending = pendingCountAny();
          const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
          if (pending > 0) result.pending = pending;
          if (tokenHint) result.hint = tokenHint;
          resyncActiveSession();
          return toResult(result);
        }
      }

      resyncActiveSession();
      const timedOutResult: Record<string, unknown> = { timed_out: true, pending: pendingCountAny() };
      if (tokenHint) timedOutResult.hint = tokenHint;
      return toResult(timedOutResult);
    },
  );
}
