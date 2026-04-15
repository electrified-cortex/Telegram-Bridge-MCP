import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault, setDequeueIdle } from "../session-manager.js";
import { getTutorialReactionHint } from "../tutorial-hints.js";
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

/** Sessions that have already received the first-dequeue hint. */
const _firstDequeueShownForSession = new Set<number>();

/** Reset the first-dequeue hint set — for use in tests only. */
export function _resetFirstDequeueHintForTest(): void {
  _firstDequeueShownForSession.clear();
}

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

const DESCRIPTION =
  "Consume queued updates. Non-content events drain first, then up to one content event (text, media, voice) is appended. " +
  "Returns: `{ updates, pending? }` with data; `{ timed_out: true }` on blocking-wait expiry (call again immediately); " +
  "`{ empty: true }` for instant polls (timeout: 0); " +
  "`{ error: \"session_closed\", message }` (isError: false) when the session queue is gone — stop looping. " +
  "pending > 0 → call again. Omit timeout to use session default (action(type: 'profile/dequeue-default'), fallback 300 s); max explicit: 300 s. " +
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

export function register(server: McpServer) {
  server.registerTool(
    "dequeue",
    {
      description: DESCRIPTION,
      inputSchema: {
        timeout: z
          .number()
          .int({ message: "timeout must be an integer number of seconds." })
          .min(0, { message: "timeout must be \u2265 0. Call help(topic: 'dequeue') for usage." })
          .max(300, { message: "timeout must be \u2264 300 s. Use action(type: 'profile/dequeue-default') to configure longer defaults." })
          .optional()
          .describe("Seconds to block when queue is empty. Omit to use your session default (set via action(type: 'profile/dequeue-default')); server fallback is 300 s. Pass 0 for an instant non-blocking poll (drain loops only). Values above the session default require force: true or action(type: 'profile/dequeue-default'). Max 300 s — use action(type: 'profile/dequeue-default') to configure persistent agents."),
        force: z
          .boolean()
          .default(false)
          .describe("Pass true to allow a one-time override when timeout exceeds your current session default. Only applies to values ≤ 300 s (the hard cap on timeout). To wait longer than 300 s by default, use action(type: 'profile/dequeue-default') instead."),
        token: TOKEN_SCHEMA,
      },
    },
    async ({ timeout, force, token }, { signal }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      // Capture the token-string hint now (before any early returns consume it).
      const tokenHint = consumeTokenStringHint();

      // First-dequeue hint: shown once per session to orient new agents.
      const isFirstDequeue = !_firstDequeueShownForSession.has(sid);
      if (isFirstDequeue) _firstDequeueShownForSession.add(sid);
      const firstDequeueHint = isFirstDequeue
        ? "Drain mode: dequeue(timeout: 0) returns immediately. Block mode: dequeue() waits up to 300s. Call again after handling — the loop is your heartbeat."
        : undefined;

      /** Combine token-string hint and first-dequeue hint into one hint string (or undefined). */
      function buildHint(tokenH: string | undefined, firstH: string | undefined): string | undefined {
        if (tokenH && firstH) return `${tokenH}; ${firstH}`;
        return tokenH ?? firstH;
      }

      // Gate: reject timeout values above the session default unless force is set
      const sessionDefault = getDequeueDefault(sid);
      const effectiveTimeout = timeout ?? sessionDefault;
      if (timeout !== undefined && timeout > sessionDefault && !force) {
        const firstOccurrence = !_timeoutHintShownForSession.has(sid);
        _timeoutHintShownForSession.add(sid);
        const response: Record<string, unknown> = {
          code: "TIMEOUT_EXCEEDS_DEFAULT",
          message: `timeout ${timeout} exceeds your current default of ${sessionDefault}s.`,
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

      // Try immediate batch dequeue
      let batch = dequeueBatchAny();
      if (batch.length > 0) {
        for (const evt of batch) ackVoice(evt);
        const pending = pendingCountAny();
        const result: Record<string, unknown> = { updates: compactBatch(batch, sid) };
        if (pending > 0) result.pending = pending;
        const hint0 = buildHint(tokenHint, firstDequeueHint);
        if (hint0) result.hint = hint0;
        const hasUserReaction0 = batch.some(
          (e) => e.event === "reaction" && e.from === "user" &&
          Array.isArray((e.content as { added?: unknown[] }).added) &&
          ((e.content as { added?: unknown[] }).added?.length ?? 0) > 0
        );
        if (hasUserReaction0) {
          const rxHint0 = getTutorialReactionHint(sid);
          if (rxHint0) result.tutorial = rxHint0;
        }
        resyncActiveSession();
        return toResult(result);
      }

      if (effectiveTimeout === 0) {
        const emptyResult: Record<string, unknown> = { empty: true, pending: pendingCountAny() };
        const hint1 = buildHint(tokenHint, firstDequeueHint);
        if (hint1) emptyResult.hint = hint1;
        return toResult(emptyResult);
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
            resyncActiveSession();
            const reminderResult: Record<string, unknown> = { updates: fired.map(buildReminderEvent), pending: pendingCountAny() };
            const hint2 = buildHint(tokenHint, firstDequeueHint);
            if (hint2) reminderResult.hint = hint2;
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
            const hint3 = buildHint(tokenHint, firstDequeueHint);
            if (hint3) result.hint = hint3;
            const hasUserReaction3 = batch.some(
              (e) => e.event === "reaction" && e.from === "user" &&
              Array.isArray((e.content as { added?: unknown[] }).added) &&
              ((e.content as { added?: unknown[] }).added?.length ?? 0) > 0
            );
            if (hasUserReaction3) {
              const rxHint3 = getTutorialReactionHint(sid);
              if (rxHint3) result.tutorial = rxHint3;
            }
            resyncActiveSession();
            return toResult(result);
          }
        }

        resyncActiveSession();
        const timedOutResult: Record<string, unknown> = { timed_out: true, pending: pendingCountAny() };
        const hint4 = buildHint(tokenHint, firstDequeueHint);
        if (hint4) timedOutResult.hint = hint4;
        return toResult(timedOutResult);
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
