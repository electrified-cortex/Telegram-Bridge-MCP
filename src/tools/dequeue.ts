import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { dlog } from "../debug-log.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault, setDequeueIdle, getSession } from "../session-manager.js";
import { recordNonToolEvent } from "../trace-log.js";
import { getSessionQueue, getMessageOwner, peekSessionCategories } from "../session-queue.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import {
  promoteDeferred,
  getActiveReminders,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
} from "../reminder-state.js";

/** Defensive clamp for a single setTimeout call, kept below Node.js's ~2^31-1 ms overflow limit. */
const MAX_SET_TIMEOUT_MS = 2_000_000_000;

/** Seconds an active reminder must be idle before it fires within dequeue. */
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

/**
 * If the batch contains at least one voice message AND there are still voice
 * messages pending in the queue, returns a hint string for the caller.
 * Returns undefined when no hint is needed.
 */
function buildVoiceBacklogHint(batch: TimelineEvent[], sid: number): string | undefined {
  const hasVoice = batch.some(e => e.event === "message" && e.content.type === "voice");
  if (!hasVoice) return undefined;
  const cats = peekSessionCategories(sid);
  const voiceCount = cats?.["voice"] ?? 0;
  if (voiceCount === 0) return undefined;
  return `${voiceCount} voice msg pending — use the 'processing' reaction preset.`;
}

const DESCRIPTION =
  "Consume queued updates. Non-content events drain first, then up to one content event (text, media, voice) is appended. " +
  "Returns: `{ updates, pending? }` with data; `{ timed_out: true }` on blocking-wait expiry (call again immediately); " +
  "`{ empty: true }` for instant polls (max_wait: 0); " +
  "`{ error: \"session_closed\", message }` (isError: false) when the session queue is gone — stop looping. " +
  "pending > 0 → call again. Omit max_wait to use session default (action(type: 'profile/dequeue-default'), fallback 300 s); max explicit: 300 s. " +
  "Call `help(topic: 'dequeue')` for details.";

/**
 * Tracks which sessions have already received the TIMEOUT_EXCEEDS_DEFAULT hint.
 * The hint is only included in the first occurrence per session to avoid repetition.
 */
const _timeoutHintShownForSession = new Set<number>();

/** Exported for test reset only — do not call in production code. */
export function _resetTimeoutHintForTest(): void {
  _timeoutHintShownForSession.clear();
}

/** Exported for test reset only — kept for backward compat with tests. */
export function _resetFirstDequeueHintForTest(): void {
  // No-op: first-dequeue hint removed.
}

export function register(server: McpServer) {
  server.registerTool(
    "dequeue",
    {
      description: DESCRIPTION,
      inputSchema: {
        max_wait: z
          .number()
          .int({ message: "max_wait must be an integer number of seconds." })
          .min(0, { message: "max_wait must be \u2265 0. Call help(topic: 'dequeue') for usage." })
          .max(300, { message: "max_wait must be \u2264 300 s. Use action(type: 'profile/dequeue-default') to configure longer defaults." })
          .optional()
          .describe("Seconds to block when queue is empty. Omit to use your session default (set via action(type: 'profile/dequeue-default')); server fallback is 300 s. Pass 0 for an instant non-blocking poll (drain loops only). Values above the session default require force: true or action(type: 'profile/dequeue-default'). Max 300 s — use action(type: 'profile/dequeue-default') to configure persistent agents. You almost never need to set this — the session default handles blocking. Only exception: max_wait: 0 for drain loops."),
        timeout: z
          .number()
          .int()
          .min(0)
          .max(300)
          .optional()
          .describe("Deprecated alias for max_wait. Use max_wait instead."),
        force: z
          .boolean()
          .default(false)
          .describe("Pass true to allow a one-time override when max_wait exceeds your current session default. Only applies to values ≤ 300 s (the hard cap on max_wait). To wait longer than 300 s by default, use action(type: 'profile/dequeue-default') instead."),
        token: TOKEN_SCHEMA,
      },
    },
    async ({ max_wait, timeout: timeoutAlias, force, token }, { signal }) => {
      // Resolve max_wait from primary param or deprecated `timeout` alias.
      const timeout = max_wait ?? timeoutAlias;
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      // Gate: reject timeout values above the session default unless force is set
      const sessionDefault = getDequeueDefault(sid);
      const effectiveTimeout = timeout ?? sessionDefault;
      if (timeout !== undefined && timeout > sessionDefault && !force) {
        const firstOccurrence = !_timeoutHintShownForSession.has(sid);
        _timeoutHintShownForSession.add(sid);
        const response: Record<string, unknown> = {
          code: "TIMEOUT_EXCEEDS_DEFAULT",
          message: `max_wait ${timeout} exceeds your current default of ${sessionDefault}s.`,
        };
        if (firstOccurrence) {
          response.hint = `Pass force: true for a one-time override, or call action(type: 'profile/dequeue-default', timeout: ${timeout}) to raise your default.`;
        }
        return toResult(response);
      }

      const sessionQueue = getSessionQueue(sid);

      if (!sessionQueue) {
        return toResult({
          error: "session_closed",
          message: `Session ${sid} has ended. Call action(type: 'session/start', ...) to open a new session if needed.`,
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

      function hasVersionedWaitAny(q: unknown): q is { getWakeVersion(): number; waitForEnqueueSince(v: number): Promise<void> } {
        return typeof (q as Record<string, unknown>)["getWakeVersion"] === "function" &&
               typeof (q as Record<string, unknown>)["waitForEnqueueSince"] === "function";
      }

      function getWakeVersionAny(q: unknown): number {
        return (q as { getWakeVersion(): number }).getWakeVersion();
      }

      function waitForEnqueueSinceAny(q: unknown, v: number): Promise<void> {
        return (q as { waitForEnqueueSince(v: number): Promise<void> }).waitForEnqueueSince(v);
      }

      // Try immediate batch dequeue
      let batch = dequeueBatchAny();
      if (batch.length > 0) {
        for (const evt of batch) ackVoice(evt);
        const pending = pendingCountAny();
        const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
        if (pending > 0) result.pending = pending;
        const hint = buildVoiceBacklogHint(batch, sid);
        if (hint) result.hint = hint;
        resyncActiveSession();
        dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
        return toResult(result);
      }

      if (effectiveTimeout === 0) {
        return toResult({ empty: true, pending: pendingCountAny() });
      }

      // Block until something arrives or timeout expires.
      // Mark session as idle for fleet visibility (session/idle action).
      const deadline = Date.now() + effectiveTimeout * 1000;
      const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });
      const reminderIdleStart = Date.now();
      setDequeueIdle(sid, true);
      try {
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
            const sessionName = getSession(sid)?.name ?? "";
            for (const reminder of fired) {
              recordNonToolEvent("reminder_fire", sid, sessionName, reminder.text);
            }
            resyncActiveSession();
            const reminderResult: Record<string, unknown> = { updates: fired.map(buildReminderEvent), pending: pendingCountAny() };
            dlog("queue", `dequeue returning sid=${sid} batch=${fired.length} payloadLen=${JSON.stringify(reminderResult).length}`);
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
          const useVersionedWait = hasVersionedWaitAny(sq);
          const wakeVersion = useVersionedWait ? getWakeVersionAny(sq) : 0;

          if (useVersionedWait) {
            // Re-check after capturing wakeVersion to avoid a lost wakeup if an
            // event arrives between an "empty" check and waiter registration.
            batch = dequeueBatchAny();
            if (batch.length > 0) {
              for (const evt of batch) ackVoice(evt);
              const pending = pendingCountAny();
              const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
              if (pending > 0) result.pending = pending;
              const hint = buildVoiceBacklogHint(batch, sid);
              if (hint) result.hint = hint;
              resyncActiveSession();
              dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
              return toResult(result);
            }
          }

          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          dlog("queue", `dequeue wait sid=${sid} wakeVersion=${wakeVersion} waitMs=${waitMs}`);
          await Promise.race([
            useVersionedWait ? waitForEnqueueSinceAny(sq, wakeVersion) : waitForEnqueueAny(),
            new Promise<void>((r) => { timeoutHandle = setTimeout(r, Math.min(Math.max(0, waitMs), MAX_SET_TIMEOUT_MS)); }),
            abortPromise,
          ]);
          clearTimeout(timeoutHandle);
          dlog("queue", `dequeue woke sid=${sid} aborted=${signal.aborted}`);

          batch = dequeueBatchAny();
          if (batch.length > 0) {
            for (const evt of batch) ackVoice(evt);
            const pending = pendingCountAny();
            const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
            if (pending > 0) result.pending = pending;
            const hint = buildVoiceBacklogHint(batch, sid);
            if (hint) result.hint = hint;
            resyncActiveSession();
            dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
            return toResult(result);
          }
        }

        resyncActiveSession();
        return toResult({ timed_out: true, pending: pendingCountAny() });
      } finally {
        // Note: if two concurrent dequeue calls share the same sid (unusual but
        // possible), the second finally will clear the idle flag while the first
        // is still waiting. This is acceptable — the session is not fully idle in
        // that case. A refcount would be needed to handle it precisely.
        setDequeueIdle(sid, false);
      }
    },
  );
}
