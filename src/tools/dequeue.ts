import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { dlog } from "../debug-log.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault, setDequeueIdle, getSession, takeSilenceHint, checkConnectionToken } from "../session-manager.js";
import { setDequeueActive, releaseNotifyDebounce, consumeUnexpectedSubscriptionClose } from "./activity/file-state.js";
import { resetChannelCooldown, flushPendingChannelNotify } from "../channel.js";
import { getSessionQueue, getMessageOwner, peekSessionCategories, deliverServiceMessage } from "../session-queue.js";
import { getAnimationStatus } from "../animation-state.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import {
  promoteDeferred,
  getSoonestDeferredMs,
  getSoonestScheduleFireMs,
} from "../reminder-state.js";
import { getGovernorSid } from "../routing-mode.js";
import { SERVICE_MESSAGES } from "../service-messages.js";

/** Defensive clamp for a single setTimeout call, kept below Node.js's ~2^31-1 ms overflow limit. */
const MAX_SET_TIMEOUT_MS = 2_000_000_000;

/** Minimum animation age (ms) before a stale warning fires on idle. */
const STALE_ANIM_MIN_AGE_MS = 30_000;

/** Minimum gap (ms) between stale-animation warnings for the same session. */
const STALE_ANIM_COOLDOWN_MS = 120_000;

// ---------------------------------------------------------------------------
// Runaway-dequeue rate guard
// ---------------------------------------------------------------------------

/** Sliding window length for dequeue-rate tracking (ms). */
const RATE_WINDOW_MS = 60_000;

/** Dequeue attempts per window before flagging as a runaway loop (tunable). */
const RATE_THRESHOLD = 20;

/** Minimum gap (ms) between rate-warning service messages per session (anti-spam). */
const RATE_WARN_COOLDOWN_MS = 30_000;

/** Per-session sliding window of dequeue-attempt timestamps (ms). */
const _dequeueAttempts = new Map<number, number[]>();

/** Per-session last-warn timestamp to rate-limit warning delivery. */
const _lastRateWarnAt = new Map<number, number>();

/**
 * Count every dequeue attempt in a per-session 60-second sliding window.
 * When the count meets or exceeds RATE_THRESHOLD, deliver a rate-limited
 * `behavior_runaway_dequeue` service message to the session.
 *
 * Never throws. Never alters dequeue semantics or latency.
 */
function checkDequeueRate(sid: number, now: number): void {
  if (sid <= 0) return;
  const cutoff = now - RATE_WINDOW_MS;
  const pruned = (_dequeueAttempts.get(sid) ?? []).filter(t => t >= cutoff);
  pruned.push(now);
  _dequeueAttempts.set(sid, pruned);
  if (pruned.length < RATE_THRESHOLD) return;
  const lastWarn = _lastRateWarnAt.get(sid) ?? 0;
  if (now - lastWarn < RATE_WARN_COOLDOWN_MS) return;
  _lastRateWarnAt.set(sid, now);
  deliverServiceMessage(
    sid,
    `RUNAWAY DEQUEUE: ${pruned.length} dequeue attempts in the last 60s — likely a stuck loop burning tokens. STOP looping; do real work or wait for a genuine signal, do not poll idly.`,
    "behavior_runaway_dequeue",
  );
}

/** Remove per-session rate-guard state on session close (prevents unbounded Map growth). */
export function removeDequeueRateState(sid: number): void {
  _dequeueAttempts.delete(sid);
  _lastRateWarnAt.delete(sid);
  // Also clean up sub-timeout and zero-result throttle state.
  _subTimeoutLastAt.delete(sid);
  _subTimeoutCount.delete(sid);
  _subTimeoutLastWarnAt.delete(sid);
  _zeroResultCount.delete(sid);
  _zeroResultLastWarnAt.delete(sid);
  // Backoff and outbound-send state (AC3/AC4).
  _backoffDelayMs.delete(sid);
  _lastOutboundSendAt.delete(sid);
}

/** Exported for test reset only — do not call in production code. */
export function _resetDequeueRateForTest(): void {
  _dequeueAttempts.clear();
  _lastRateWarnAt.clear();
}

// ---------------------------------------------------------------------------
// Sub-timeout dequeue detection (AC1)
// ---------------------------------------------------------------------------

/**
 * Reference interval (ms) for sub-timeout detection.
 * Dequeues consistently faster than this gap prevent inactivity-based reminders
 * from ever accruing enough idle time to fire. 60 s matches the typical minimum
 * reminder delay_seconds and the spec example ("e.g. every 30s when reminders
 * fire after 60s idle").
 */
const SUB_TIMEOUT_REF_MS = 60_000;

/**
 * Number of consecutive sub-timeout intervals before warning.
 * AC1: spec example is "e.g. 10 dequeues all ~37s apart" → 10 consecutive.
 */
const SUB_TIMEOUT_CONSECUTIVE_THRESHOLD = 10;

/** Minimum gap (ms) between sub-timeout warning messages per session (anti-spam). */
const SUB_TIMEOUT_WARN_COOLDOWN_MS = 120_000;

/** Per-session: timestamp (ms) of the last dequeue, for interval measurement. */
const _subTimeoutLastAt = new Map<number, number>();

/** Per-session: number of consecutive dequeue intervals < SUB_TIMEOUT_REF_MS. */
const _subTimeoutCount = new Map<number, number>();

/** Per-session: last sub-timeout warning timestamp for cooldown enforcement. */
const _subTimeoutLastWarnAt = new Map<number, number>();

// ---------------------------------------------------------------------------
// Exponential backoff (AC3) — delay before honoring next dequeue
// ---------------------------------------------------------------------------

/** Initial backoff delay (ms) on first detection event. */
const BACKOFF_INITIAL_MS = 5_000;

/** Maximum backoff delay (ms). Schedule caps here regardless of trigger count. */
const BACKOFF_MAX_MS = 60_000;

/** Per-session: current pending backoff delay in ms. 0 / absent = no active backoff. */
const _backoffDelayMs = new Map<number, number>();

/**
 * Enter or increase the exponential backoff for a session.
 * First trigger: delay = BACKOFF_INITIAL_MS (5 s).
 * Each subsequent trigger while still in backoff: delay doubles, capped at BACKOFF_MAX_MS (60 s).
 */
function enterOrIncreaseBackoff(sid: number): void {
  const current = _backoffDelayMs.get(sid) ?? 0;
  const next = current === 0 ? BACKOFF_INITIAL_MS : Math.min(current * 2, BACKOFF_MAX_MS);
  _backoffDelayMs.set(sid, next);
}

/** Reset the backoff state for a session. Called on content-returning dequeue or outbound send. */
function resetBackoff(sid: number): void {
  _backoffDelayMs.delete(sid);
}

/** Injected sleep function for unit tests (undefined = real setTimeout). */
let _backoffSleepFn: ((ms: number) => Promise<void>) | undefined;

/** For tests only: inject a custom sleep function to control backoff timing. */
export function _setBackoffSleepForTest(fn: ((ms: number) => Promise<void>) | undefined): void {
  _backoffSleepFn = fn;
}

/** For tests only: return the current backoff delay (ms) for a session. */
export function _getBackoffDelayForTest(sid: number): number {
  return _backoffDelayMs.get(sid) ?? 0;
}

/**
 * AC1 — Sub-timeout dequeue detection.
 *
 * Call this at each dequeue result path (not at call-start) so hasContent is known.
 *
 * hasContent = true  → agent is legitimately busy; reset counter (AC3 / exemption).
 * hasContent = false → empty poll; check interval and accumulate consecutive count.
 *
 * Tracks consecutive empty-poll intervals shorter than SUB_TIMEOUT_REF_MS.
 * When >= SUB_TIMEOUT_CONSECUTIVE_THRESHOLD consecutive short-interval empty polls
 * are observed, delivers a `behavior_dequeue_sub_timeout` service message
 * (rate-limited by SUB_TIMEOUT_WARN_COOLDOWN_MS).
 *
 * Resets the consecutive count when:
 *   - content is returned (agent is busy, not idle-polling)
 *   - the interval between empty polls is >= SUB_TIMEOUT_REF_MS (AC3)
 *
 * For timed_out exits (long blocking wait), the interval from the previous call
 * will be >= the timeout duration (typically >> 60 s), so the counter self-resets.
 *
 * Never throws. Never alters dequeue semantics or latency.
 */
function checkSubTimeoutDequeue(sid: number, now: number, hasContent: boolean): void {
  if (sid <= 0) return;
  const lastAt = _subTimeoutLastAt.get(sid);
  _subTimeoutLastAt.set(sid, now);

  if (hasContent) {
    // Content-returning dequeue — agent is legitimately active; reset counter (AC3).
    _subTimeoutCount.set(sid, 0);
    return;
  }

  if (lastAt === undefined) {
    // First dequeue for this session — no interval to measure yet.
    _subTimeoutCount.set(sid, 0);
    return;
  }

  const interval = now - lastAt;
  if (interval < SUB_TIMEOUT_REF_MS) {
    // Short interval — accumulate consecutive count.
    const count = (_subTimeoutCount.get(sid) ?? 0) + 1;
    _subTimeoutCount.set(sid, count);

    if (count >= SUB_TIMEOUT_CONSECUTIVE_THRESHOLD) {
      const lastWarn = _subTimeoutLastWarnAt.get(sid) ?? 0;
      if (now - lastWarn >= SUB_TIMEOUT_WARN_COOLDOWN_MS) {
        _subTimeoutLastWarnAt.set(sid, now);
        // AC3: insert exponential backoff penalty — next dequeue will be delayed.
        enterOrIncreaseBackoff(sid);
        deliverServiceMessage(
          sid,
          `DEQUEUE TOO FAST: ${count + 1} consecutive empty polls all under ${SUB_TIMEOUT_REF_MS / 1000}s apart — inactivity-based reminders require sustained idle time and will never fire at this rate. Switch to the activity-file/SSE wake pattern and use max_wait ≥ ${SUB_TIMEOUT_REF_MS / 1000}s, or call dequeue(max_wait: 300) once and let the server wake you.`,
          "behavior_dequeue_sub_timeout",
        );
      }
    }
  } else {
    // Normal (long enough) interval — reset consecutive sub-timeout count (AC3).
    _subTimeoutCount.set(sid, 0);
  }
}

// ---------------------------------------------------------------------------
// Zero-result rapid-fire detection (AC2)
// ---------------------------------------------------------------------------

/**
 * Consecutive zero-result instant-poll threshold before warning (AC2).
 * "suggested threshold: ~5" → 5.
 */
const ZERO_RESULT_CONSECUTIVE_THRESHOLD = 5;

/** Minimum gap (ms) between zero-result warning messages per session (anti-spam). */
const ZERO_RESULT_WARN_COOLDOWN_MS = 120_000;

/** Per-session: count of consecutive instant polls (max_wait: 0) with no content returned. */
const _zeroResultCount = new Map<number, number>();

/** Per-session: last zero-result warning timestamp for cooldown enforcement. */
const _zeroResultLastWarnAt = new Map<number, number>();

/**
 * AC2 / AC3 — Zero-result rapid-fire detection.
 *
 * Call this after each instant poll (max_wait: 0) returns:
 *   hasContent = true  → content returned; reset consecutive counter (AC3).
 *   hasContent = false → no content; increment counter, warn at threshold.
 *
 * Long-poll exits (timed_out: true) are intentionally excluded — the agent
 * is correctly blocking and is not burning tokens with rapid polls.
 *
 * Never throws. Never alters dequeue semantics or latency.
 */
function checkZeroResultRapidFire(sid: number, now: number, hasContent: boolean): void {
  if (sid <= 0) return;

  if (hasContent) {
    // Content-returning dequeue — reset counter (AC3).
    _zeroResultCount.set(sid, 0);
    return;
  }

  const count = (_zeroResultCount.get(sid) ?? 0) + 1;
  _zeroResultCount.set(sid, count);

  if (count >= ZERO_RESULT_CONSECUTIVE_THRESHOLD) {
    const lastWarn = _zeroResultLastWarnAt.get(sid) ?? 0;
    if (now - lastWarn >= ZERO_RESULT_WARN_COOLDOWN_MS) {
      _zeroResultLastWarnAt.set(sid, now);
      // AC3: insert exponential backoff penalty — next dequeue will be delayed.
      enterOrIncreaseBackoff(sid);
      deliverServiceMessage(
        sid,
        `IDLE DEQUEUE LOOP: ${count} consecutive instant polls returned no content — you're burning tokens polling an empty queue. Use the SSE monitor or activity-file to wait for real messages. Call dequeue(max_wait: 300) once and let the server wake you when content arrives.`,
        "behavior_dequeue_zero_result",
      );
    }
  }
}

/** Exported for test reset only — do not call in production code. */
export function _resetDequeueThrottleForTest(): void {
  _subTimeoutLastAt.clear();
  _subTimeoutCount.clear();
  _subTimeoutLastWarnAt.clear();
  _zeroResultCount.clear();
  _zeroResultLastWarnAt.clear();
  _backoffDelayMs.clear();
  _lastOutboundSendAt.clear();
  _backoffSleepFn = undefined;
}

// ---------------------------------------------------------------------------
// Outbound-send exemption state (AC4)
// ---------------------------------------------------------------------------

/** Per-session: timestamp (ms) of the most recent confirmed outbound send. */
const _lastOutboundSendAt = new Map<number, number>();

/**
 * Called when this session has sent an outbound message (confirmed by the bridge).
 * Resets all throttle counters and clears any active backoff. An agent actively
 * sending messages is legitimately busy and must NOT be penalized for rapid-dequeue.
 *
 * Wired from index.ts via setOutboundSendCallback (session-queue.ts) at startup.
 */
export function notifyDequeueOutboundSend(sid: number, now?: number): void {
  if (sid <= 0) return;
  const t = now ?? Date.now();
  _lastOutboundSendAt.set(sid, t);
  _subTimeoutCount.set(sid, 0);
  _zeroResultCount.set(sid, 0);
  resetBackoff(sid);
}

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

/** Exported for test reset only — kept for backward compat with tests. */
export function _resetActivityFileHintForTest(): void {
  // No-op: activity-file hint removed; LOOP_PATTERN now covers it.
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
  _responseFormat: "default" | "compact" = "default",
): Promise<Record<string, unknown>> {
  const sessionQueue = getSessionQueue(sid);

  if (!sessionQueue) {
    return {
      error: "session_closed",
      message: `Session ${sid} has ended. Call action(type: 'session/start', ...) to open a new session if needed.`,
    };
  }

  // AC3: Apply exponential backoff penalty if a prior detection event set a delay.
  const _pendingBackoffMs = _backoffDelayMs.get(sid) ?? 0;
  if (_pendingBackoffMs > 0) {
    const sleepPromise = _backoffSleepFn
      ? _backoffSleepFn(_pendingBackoffMs)
      : new Promise<void>(r => { setTimeout(r, _pendingBackoffMs); });
    await Promise.race([
      sleepPromise,
      new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); }),
    ]);
  }

  // Count every dequeue attempt (including idle/empty polls) for runaway-loop detection.
  checkDequeueRate(sid, Date.now());

  // R5: First-dequeue detection for child sessions — inject onboarding before any content drain.
  // Checked here: after session existence confirmed, before setDequeueActive or content reads.
  const _childSession = getSession(sid);
  if (_childSession?.parent_sid && !_childSession.firstDequeueOccurred) {
    _childSession.firstDequeueOccurred = true;
    const _childToken = _childSession.sid * 1_000_000 + _childSession.suffix;
    const _topicName = _childSession.name;
    const _parentSid = _childSession.parent_sid;
    const _parentSession = getSession(_parentSid);
    const _parentName = _parentSession?.name ?? "";

    // R4: deliver four narrowed onboarding messages on child session's first dequeue.
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.ONBOARDING_CHILD_TOKEN.text,
      SERVICE_MESSAGES.ONBOARDING_CHILD_TOKEN.eventType,
    );
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.CHILD_ONBOARDING_ROLE.text(_topicName, _parentSid, _parentName),
      SERVICE_MESSAGES.CHILD_ONBOARDING_ROLE.eventType,
    );
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.CHILD_ONBOARDING_LOOP.text(_childToken),
      SERVICE_MESSAGES.CHILD_ONBOARDING_LOOP.eventType,
    );
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.CHILD_ONBOARDING_EXIT_PROTOCOL.text(_childToken),
      SERVICE_MESSAGES.CHILD_ONBOARDING_EXIT_PROTOCOL.eventType,
    );

    // R4: fire CHILD_FIRST_DEQUEUE_CONFIRMED to parent SID (skip silently if parent gone)
    if (_parentSession) {
      deliverServiceMessage(
        _parentSid,
        SERVICE_MESSAGES.CHILD_FIRST_DEQUEUE_CONFIRMED.text(sid, _childSession.name, _topicName),
        SERVICE_MESSAGES.CHILD_FIRST_DEQUEUE_CONFIRMED.eventType,
      );
    }
  }

  // AC1-AC3 (10-3029): If a subscription closed unexpectedly since the last dequeue
  // (SSE connection dropped without cancel, or activity-file retry exhausted), inject
  // a one-shot SUBSCRIPTION_CLOSED_UNEXPECTEDLY service message so the agent can
  // detect and recover from silent monitor loss.
  // consumeUnexpectedSubscriptionClose is idempotent-safe: returns true exactly once
  // per subscription-loss event, then false until another event is recorded.
  if (consumeUnexpectedSubscriptionClose(sid)) {
    deliverServiceMessage(sid, SERVICE_MESSAGES.SUBSCRIPTION_CLOSED_UNEXPECTEDLY);
  }

  // Mark this session as having an in-flight dequeue — suppresses activity-file notifications
  // while the agent is actively waiting for messages.
  // Only set after confirming the session exists so every path through the
  // try/finally below is guaranteed to call setDequeueActive(sid, false).
  setDequeueActive(sid, true);

  // ONBOARDING_LOOP_PATTERN already covers the activity-file guidance at session
  // start. The redundant activity-file hint on first dequeue is intentionally
  // removed — the loop-pattern message says steps 1 and 2 once; the follow-up
  // ACTIVITY_FILE_MONITOR_INSTRUCTIONS message lands when the agent actually
  // calls activity/file/create.

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
    const batch = sq.dequeueBatch();
    // §5-b decision B: messages-first ordering — reminders yield to real messages.
    return batch.sort((a, b) => {
      const aR = a.event === "reminder" ? 1 : 0;
      const bR = b.event === "reminder" ? 1 : 0;
      return aR - bR;
    });
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
    // suppress_pending_hint profile flag: omit the entire hint field when set.
    if (getSession(sid)?.suppress_pending_hint !== true) {
      const hints: string[] = [];
      const silenceHint = takeSilenceHint(sid);
      if (silenceHint !== undefined) hints.push(silenceHint);
      const voiceHint = buildVoiceBacklogHint(events, sid);
      if (voiceHint !== undefined) hints.push(voiceHint);
      // Pending-queue nudge: when more messages are waiting, suggest the
      // processing preset so the operator knows the agent sees the backlog.
      if (pending > 0) hints.push(`pending=${pending}; use processing preset.`);
      if (hints.length > 0) result.hint = hints.join(" ");
    }
    return result;
  }

  // Promote deferred reminders whose delay has elapsed before any early return.
  // Without this, a busy session (always has immediate messages) or an agent
  // using max_wait:0 exclusively would never call promoteDeferred, leaving a
  // deferred reminder stuck in that state indefinitely even at fires_in_seconds=0.
  promoteDeferred(sid);

  // Try immediate batch dequeue
  let batch = dequeueBatchAny();
  if (batch.length > 0) {
    for (const evt of batch) ackVoice(evt);
    const result = buildBatchResult(batch);
    resyncActiveSession();
    dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
    // AC1/AC2/AC3: content-returning path resets throttle counters and clears backoff.
    const _contentNow = Date.now();
    checkSubTimeoutDequeue(sid, _contentNow, true);
    checkZeroResultRapidFire(sid, _contentNow, true);
    resetBackoff(sid);
    // Immediate-batch return is outside the try/finally below — clear state here.
    setDequeueActive(sid, false);
    // Content-returning exit: reset channel cooldown (agent consumed content, no re-notify needed).
    // Do NOT release SSE notify debounce here — debounce persists through active drain cycles.
    resetChannelCooldown(sid);
    return result;
  }

  if (timeout === 0) {
    // Timeout=0 empty-poll: not content-returning — do NOT release notify debounce.
    // AC1/AC2: track consecutive fast empty polls; may warn if thresholds exceeded.
    const _emptyNow = Date.now();
    checkSubTimeoutDequeue(sid, _emptyNow, false);
    checkZeroResultRapidFire(sid, _emptyNow, false);
    setDequeueActive(sid, false);
    return { pending: pendingCountAny() };
  }

  // Block until something arrives or timeout expires.
  // Mark session as idle for fleet visibility (session/idle action).
  const deadline = Date.now() + timeout * 1000;
  const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });
  let _staleWarnSent = false;
  setDequeueIdle(sid, true);
  // _contentDequeue: true when this call returns content → reset channel cooldown only.
  // SSE notify debounce is NOT released on content returns; it persists through drain cycles.
  // Only timed_out: true (agent went fully idle) cancels the debounce and re-arms notify.
  let _contentDequeue = false;
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
            _contentDequeue = true;
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
      // (Active reminders are picked up by the module-level sweep in reminder-state.ts §5-b)
      promoteDeferred(sid);

      const now = Date.now();
      const remaining = deadline - now;
      if (remaining <= 0) break;

      // Wake up as soon as the earliest of: next deferred promotion, schedule fire, or timeout.
      // §5-b: active and event-triggered reminders are delivered via sweeps/enqueueToSession,
      // not by the dequeue loop. Only schedule fire and deferred promotion need explicit timing.
      const deferredMs = getSoonestDeferredMs(sid);
      const scheduleFireMs = getSoonestScheduleFireMs(sid); // §R-6: wake exactly at next_fire_ms
      const waitMs = Math.min(remaining, deferredMs ?? Infinity, scheduleFireMs ?? Infinity);
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
          // AC1/AC2/AC3: content-returning path resets throttle counters and clears backoff.
          const _vwContentNow = Date.now();
          checkSubTimeoutDequeue(sid, _vwContentNow, true);
          checkZeroResultRapidFire(sid, _vwContentNow, true);
          resetBackoff(sid);
          _contentDequeue = true;
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
        // AC1/AC2/AC3: content-returning path resets throttle counters and clears backoff.
        const _waitContentNow = Date.now();
        checkSubTimeoutDequeue(sid, _waitContentNow, true);
        checkZeroResultRapidFire(sid, _waitContentNow, true);
        resetBackoff(sid);
        _contentDequeue = true;
        return result;
      }
    }

    resyncActiveSession();
    const pending = pendingCountAny();
    // Timeout exit: agent went fully idle — cancel debounce so next inbound fires a fresh notify.
    // Do NOT reset channel cooldown here; it expires naturally on its own (see channel.ts model).
    releaseNotifyDebounce(sid);
    flushPendingChannelNotify(sid);
    return { timed_out: true, ...(pending > 0 ? { pending } : {}) };
  } finally {
    // Note: if two concurrent dequeue calls share the same sid (unusual but
    // possible), the second finally will clear the idle flag while the first
    // is still waiting. This is acceptable — the session is not fully idle in
    // that case. A refcount would be needed to handle it precisely.
    setDequeueIdle(sid, false);
    setDequeueActive(sid, false);
    // Content-returning exit: reset channel cooldown so the agent isn't re-notified
    // about content it just consumed. SSE notify debounce is NOT released here —
    // it persists through active drain cycles and is only cancelled on timed_out: true.
    if (_contentDequeue) resetChannelCooldown(sid);
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
          .describe("Seconds to block when queue is empty. Omit to use your session default (fallback 300 s). Values above the session default require force: true. Use action(type: 'profile/dequeue-default') to raise your default."),
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
          .describe("Response format. \"compact\" suppresses inferrable fields; `timed_out: true` is always emitted regardless of compact mode. Defaults to \"default\"."),
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
