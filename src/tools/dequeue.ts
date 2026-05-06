import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { dlog } from "../debug-log.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault, setDequeueIdle, getSession, takeSilenceHint, checkConnectionToken } from "../session-manager.js";
import { setDequeueActive } from "./activity/file-state.js";
import { recordNonToolEvent } from "../trace-log.js";
import { getSessionQueue, getMessageOwner, peekSessionCategories, deliverServiceMessage } from "../session-queue.js";
import { getAnimationStatus } from "../animation-state.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import {
  promoteDeferred,
  getActiveReminders,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
} from "../reminder-state.js";
import { getGovernorSid } from "../routing-mode.js";
import { SERVICE_MESSAGES } from "../service-messages.js";

/** Defensive clamp for a single setTimeout call, kept below Node.js's ~2^31-1 ms overflow limit. */
const MAX_SET_TIMEOUT_MS = 2_000_000_000;

/** Seconds an active reminder must be idle before it fires within dequeue. */
const REMINDER_IDLE_THRESHOLD_MS = 60_000;

/** Minimum animation age (ms) before a stale warning fires on idle. */
const STALE_ANIM_MIN_AGE_MS = 30_000;

/** Minimum gap (ms) between stale-animation warnings for the same session. */
const STALE_ANIM_COOLDOWN_MS = 120_000;

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
  return `${voiceCount} voice msg pending — react with processing preset.`;
}

const DESCRIPTION =
  "Consume queued updates. Non-content events drain first, then up to one content event (text, media, voice) is appended. " +
  "Returns: `{ updates, pending? }` with data; `{ timed_out: true }` on blocking-wait expiry (call again immediately); " +
  "`{ empty: true }` for instant polls (max_wait: 0); " +
  "`{ error: \"session_closed\", message }` (isError: false) when the session queue is gone — stop looping. " +
  "pending > 0 → call again. Omit max_wait to use session default (action(type: 'profile/dequeue-default'), fallback 300 s); max explicit: 300 s. " +
  "Pass connection_token (from session/start) to enable duplicate-session detection — the bridge alerts the governor if two callers share the same identity. " +
  "Call `help(topic: 'dequeue')` for details.";

/**
 * Tracks which sessions have already received the TIMEOUT_EXCEEDS_DEFAULT hint.
 * The hint is only included in the first occurrence per session to avoid repetition.
 */
const _timeoutHintShownForSession = new Set<number>();

/**
 * Tracks the last time (Date.now()) each session received an animation_stale_warning
 * service message. Used to rate-limit warnings to at most once per 120 seconds.
 */
const _lastStaleWarningSentAt = new Map<number, number>();

/** Exported for test reset only — do not call in production code. */
export function _resetStaleWarningMapForTest(): void {
  _lastStaleWarningSentAt.clear();
}

/** Exported for test reset only — do not call in production code. */
export function _resetTimeoutHintForTest(): void {
  _timeoutHintShownForSession.clear();
}

/** Exported for test reset only — kept for backward compat with tests. */
export function _resetFirstDequeueHintForTest(): void {
  // No-op: first-dequeue hint removed.
}

/**
 * Core dequeue drain loop — shared by the MCP tool and the HTTP /dequeue endpoint.
 *
 * @param sid          Validated session ID (caller must auth before calling this).
 * @param timeout      Effective timeout in seconds (0 = instant poll, 1–300 = long-poll).
 * @param signal       AbortSignal — abort to cut the long-poll early (e.g. HTTP disconnect).
 * @param responseFormat  "compact" suppresses `empty: true` on instant polls.
 * @returns Plain data object — caller wraps with toResult() for MCP or returns as JSON for HTTP.
 */
export async function runDrainLoop(
  sid: number,
  timeout: number,
  signal: AbortSignal,
  responseFormat: "default" | "compact" = "default",
): Promise<Record<string, unknown>> {
  const sessionQueue = getSessionQueue(sid);

  if (!sessionQueue) {
    return {
      error: "session_closed",
      message: `Session ${sid} has ended. Call action(type: 'session/start', ...) to open a new session if needed.`,
    };
  }

  // Mark this session as having an in-flight dequeue — suppresses activity-file kicks
  // while the agent is actively waiting for messages.
  // Only set after confirming the session exists so every path through the
  // try/finally below is guaranteed to call setDequeueActive(sid, false).
  setDequeueActive(sid, true);

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

  /** Build a content batch result, attaching any pending hints. */
  function buildBatchResult(events: TimelineEvent[]): Record<string, unknown> {
    const pending = pendingCountAny();
    const result: Record<string, unknown> = { updates: compactBatch(events, sid) };
    if (pending > 0) result.pending = pending;
    const hints: string[] = [];
    const silenceHint = takeSilenceHint(sid);
    if (silenceHint !== undefined) hints.push(silenceHint);
    const voiceHint = buildVoiceBacklogHint(events, sid);
    if (voiceHint !== undefined) hints.push(voiceHint);
    // Pending-queue nudge: when more messages are waiting, suggest the
    // processing preset so the operator knows the agent sees the backlog.
    // TODO: honor a profile flag (e.g. ProfileData.suppress_pending_hint)
    // to let agents opt out once that flag is introduced in profile-store.ts.
    if (pending > 0) hints.push(`pending=${pending}; use processing preset.`);
    if (hints.length > 0) result.hint = hints.join(" ");
    return result;
  }

  // Try immediate batch dequeue
  let batch = dequeueBatchAny();
  if (batch.length > 0) {
    for (const evt of batch) ackVoice(evt);
    const result = buildBatchResult(batch);
    resyncActiveSession();
    dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
    return result;
  }

  if (timeout === 0) {
    const compact = responseFormat === "compact";
    return { ...(compact ? {} : { empty: true }), pending: pendingCountAny() };
  }

  // Block until something arrives or timeout expires.
  // Mark session as idle for fleet visibility (session/idle action).
  const deadline = Date.now() + timeout * 1000;
  const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });
  const reminderIdleStart = Date.now();
  let _staleWarnSent = false;
  setDequeueIdle(sid, true);
  try {
    while (Date.now() < deadline) {
      if (signal.aborted) break;

      // On first idle iteration, warn once (rate-limited) if an animation has been
      // running long enough and we haven't warned this session recently.
      if (!_staleWarnSent) {
        _staleWarnSent = true;
        const _animStatus = getAnimationStatus(sid);
        if (_animStatus.active) {
          const ageMs = Date.now() - _animStatus.started_at;
          const lastWarn = _lastStaleWarningSentAt.get(sid) ?? 0;
          if (ageMs >= STALE_ANIM_MIN_AGE_MS && Date.now() - lastWarn >= STALE_ANIM_COOLDOWN_MS) {
            _lastStaleWarningSentAt.set(sid, Date.now());
            resyncActiveSession();
            dlog("queue", `dequeue stale animation warning sid=${sid} message_id=${_animStatus.message_id}`);
            return {
              updates: [{
                event: "animation_stale_warning",
                message_id: _animStatus.message_id,
                age_seconds: Math.floor(ageMs / 1000),
              }],
            };
          }
        }
      }

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
        const reminderPending = pendingCountAny();
        const reminderResult: Record<string, unknown> = {
          updates: fired.map(buildReminderEvent),
          ...(reminderPending > 0 ? { pending: reminderPending } : {}),
        };
        dlog("queue", `dequeue returning sid=${sid} batch=${fired.length} payloadLen=${JSON.stringify(reminderResult).length}`);
        // responseFormat is not applied here: the reminder response only contains
        // `updates` (real event data) and optionally `pending` (when > 0), neither
        // of which are compact-suppressible fields.
        return reminderResult;
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
          const result = buildBatchResult(batch);
          resyncActiveSession();
          dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
          return result;
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
        const result = buildBatchResult(batch);
        resyncActiveSession();
        dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
        return result;
      }
    }

    resyncActiveSession();
    const pending = pendingCountAny();
    return { timed_out: true, ...(pending > 0 ? { pending } : {}) };
  } finally {
    // Note: if two concurrent dequeue calls share the same sid (unusual but
    // possible), the second finally will clear the idle flag while the first
    // is still waiting. This is acceptable — the session is not fully idle in
    // that case. A refcount would be needed to handle it precisely.
    setDequeueIdle(sid, false);
    // Re-arm activity-file nudge cycle and update lastActivityAt.
    setDequeueActive(sid, false);
  }
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
          .min(0, { message: "max_wait must be ≥ 0. Call help(topic: 'dequeue') for usage." })
          .max(300, { message: "max_wait must be ≤ 300 s. Use action(type: 'profile/dequeue-default') to configure longer defaults." })
          .optional()
          .describe("Seconds to block when queue is empty. Omit to use your session default (fallback 300 s). Pass 0 for an instant non-blocking poll (drain loops). Values above the session default require force: true. Use action(type: 'profile/dequeue-default') to raise your default."),
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
        connection_token: z
          .uuid()
          .optional()
          .describe("UUID returned by session/start. Pass on every dequeue call to enable duplicate-session detection. The bridge alerts the governor (without rejecting the call) if two agents share the same SID but present different connection tokens."),
        response_format: z
          .enum(["default", "compact"])
          .optional()
          .describe("Response format. \"compact\" only suppresses `empty: true` (inferrable from the caller's use of `max_wait: 0`); `timed_out: true` is always emitted regardless of compact mode. Defaults to \"default\"."),
      },
    },
    async ({ max_wait, timeout: timeoutAlias, force, token, connection_token, response_format }, { signal }) => {
      // Resolve max_wait from primary param or deprecated `timeout` alias.
      const timeout = max_wait ?? timeoutAlias;
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      // Option A — Duplicate session detection:
      // If the caller passes a connection_token, check it against the one stored
      // at session/start. A mismatch means two agents are sharing the same SID/suffix
      // (e.g. via shared memory files). We do NOT reject the call — both callers are
      // allowed to proceed — but we alert the governor so the operator can investigate.
      //
      // Open design questions:
      //   1. Rate-limiting: Should we throttle governor alerts to avoid flooding?
      //      Currently we fire once per mismatch event. A per-session cooldown would
      //      reduce noise during a runaway duplicate loop.
      //   2. connection_token on reconnect: session/reconnect does NOT regenerate
      //      the connection_token (it reuses the stored one). If a caller after reconnect
      //      passes the old token, it will match. If they lost it, they omit it → "absent".
      //      This is intentional to avoid false positives on reconnect.
      //   3. Alert delivery: alerts go to the governor queue (in-process service message).
      //      If no governor is set, the alert is logged via dlog (see else branch below).
      //      A future improvement could deliver to all active sessions.
      if (connection_token && sid > 0) {
        const tokenStatus = checkConnectionToken(sid, connection_token);
        if (tokenStatus === "mismatch") {
          const sessionName = getSession(sid)?.name ?? "";
          dlog("session", `duplicate session detected sid=${sid} name=${sessionName}`);
          const governorSid = getGovernorSid();
          if (governorSid > 0 && governorSid !== sid) {
            deliverServiceMessage(
              governorSid,
              SERVICE_MESSAGES.DUPLICATE_SESSION_DETECTED.text(sid, sessionName),
              SERVICE_MESSAGES.DUPLICATE_SESSION_DETECTED.eventType,
              { sid, name: sessionName },
            );
          } else {
            // No governor to alert (unset or is the duplicate itself) — record a
            // debug trace so the mismatch is observable even without a governor.
            dlog(
              "session",
              `duplicate session mismatch with no alertable governor — sid=${sid} name=${sessionName} governorSid=${governorSid}`,
            );
          }
        }
      }

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

      const result = await runDrainLoop(sid, effectiveTimeout, signal, response_format);
      return toResult(result);
    },
  );
}
