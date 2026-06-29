import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, ackVoiceMessage } from "../telegram.js";
import { dlog } from "../debug-log.js";
import { requireAuth } from "../session-gate.js";
import {
  type TimelineEvent,
} from "../message-store.js";
import { setActiveSession, touchSession, getDequeueDefault, setDequeueIdle, getSession, takeSilenceHint, checkConnectionToken } from "../session-manager.js";
import { setDequeueActive, releaseNotifyDebounce, isSseMonitorActive, isActivityFileActive } from "./activity/file-state.js";
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


// ---------------------------------------------------------------------------
// Thinking indicator — actionable content detection
// ---------------------------------------------------------------------------

/**
 * Content types that qualify as "actionable operator content" for the
 * auto-Thinking trigger. Mirrors OPERATOR_MESSAGE_TYPES in session-queue.ts.
 * Only events where from="user", event="message", and content.type ∈ this set
 * count as actionable operator messages.
 */
const _THINKING_TRIGGER_TYPES = new Set([
  "text", "voice", "command", "photo", "doc", "video",
  "audio", "sticker", "animation", "contact", "location", "unknown",
]);

/**
 * Fire the Thinking indicator if the batch contains any meaningful work:
 * - Actionable operator messages (user-originated message events)
 * - Agent DMs (direct_message events from other sessions)
 * - Reminders that produce actionable work (reminder events)
 *
 * Thinking is auto-canceled by the outbound-proxy cancel-on-send when the
 * same SID sends text, audio, or a file. No agent action needed.
 *
 * Best-effort, fire-and-forget — never blocks the dequeue return.
 */
function _fireThinkingIfActionable(_sid: number, _batch: TimelineEvent[]): void {
  // Auto-thinking disabled: the sendMessageDraft approach produced unwanted
  // visual artifacts. Thinking state is still available for manual agent use
  // via extendThinking / the thinking/extend + thinking/close tools.
  // Re-enable here once a proper visual design is agreed on.
}

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

// ---------------------------------------------------------------------------
// Dequeue-pattern behavioral nudge (10-3028)
// ---------------------------------------------------------------------------

/** Window (ms) after a `timed_out` response within which a re-poll is considered rapid. */
const RAPID_REPOLL_WINDOW_MS = 5_000;

/** Number of rapid re-polls (no messages, monitor active) before the nudge fires. */
const REPOLL_THRESHOLD = 2;

/** Per-session count of rapid dequeue re-polls after `timed_out` with no messages. */
const _dequeueAfterTimeoutCount = new Map<number, number>();

/** Per-session timestamp (ms) when the last `timed_out: true` was returned. */
const _lastTimeoutAt = new Map<number, number>();

/**
 * Per-session flag indicating the nudge has already fired for this subscription
 * lifetime. Cleared when the agent re-establishes a monitor subscription.
 */
const _nudgeFiredForSession = new Set<number>();

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
}

/** Exported for test reset only — do not call in production code. */
export function _resetDequeueRateForTest(): void {
  _dequeueAttempts.clear();
  _lastRateWarnAt.clear();
}

/** Remove per-session dequeue-pattern nudge state on session close. */
export function removeDequeuePatternNudgeState(sid: number): void {
  _dequeueAfterTimeoutCount.delete(sid);
  _lastTimeoutAt.delete(sid);
  _nudgeFiredForSession.delete(sid);
}

/**
 * Re-arm the dequeue-pattern nudge for a session.
 * Call when the agent re-establishes a monitor subscription (SSE connect or
 * activity-file re-create) so the nudge can fire again if the pattern recurs.
 */
export function resetDequeuePatternNudgeForSession(sid: number): void {
  _dequeueAfterTimeoutCount.delete(sid);
  _lastTimeoutAt.delete(sid);
  _nudgeFiredForSession.delete(sid);
}

/** Exported for test reset only — do not call in production code. */
export function _resetDequeuePatternNudgeForTest(): void {
  _dequeueAfterTimeoutCount.clear();
  _lastTimeoutAt.clear();
  _nudgeFiredForSession.clear();
}

/** Exported for test seeding only — do not call in production code. */
export function _seedDequeuePatternNudgeForTest(sid: number): void {
  _dequeueAfterTimeoutCount.set(sid, 1);
  _lastTimeoutAt.set(sid, Date.now());
  _nudgeFiredForSession.add(sid);
}

/** Exported for test inspection only — returns true if any per-session state exists for sid. */
export function hasDequeuePatternNudgeStateForSession(sid: number): boolean {
  return _dequeueAfterTimeoutCount.has(sid) || _lastTimeoutAt.has(sid) || _nudgeFiredForSession.has(sid);
}

/**
 * Check if this dequeue call is a rapid re-poll after `timed_out: true`.
 *
 * Fires a `behavior_nudge_dequeue_pattern` service message when ALL hold:
 *   1. The session returned `timed_out: true` within RAPID_REPOLL_WINDOW_MS
 *   2. The session has an active monitor subscription (SSE or activity file)
 *   3. The rapid-repoll count reaches REPOLL_THRESHOLD (grace for single misfire)
 *   4. The nudge has not already fired for this subscription lifetime (AC5)
 *
 * "Messages delivered in the window" is handled organically: when a call returns
 * a batch, the batch-return paths delete `_lastTimeoutAt` and reset the counter,
 * so the nudge cannot fire on any call that follows a message-delivering call.
 *
 * No active monitor suppresses the nudge — polling without a subscription is valid.
 *
 * Never throws. Never alters dequeue semantics.
 */
function checkDequeuePatternNudge(sid: number, now: number): void {
  if (sid <= 0) return;

  const lastTimeout = _lastTimeoutAt.get(sid);

  // No recent timed_out → clear stale counter and return
  if (!lastTimeout || now - lastTimeout >= RAPID_REPOLL_WINDOW_MS) {
    _dequeueAfterTimeoutCount.delete(sid);
    return;
  }

  // No active monitor → polling without a subscription is valid; do not nudge
  if (!isSseMonitorActive(sid) && !isActivityFileActive(sid)) {
    return;
  }

  // Increment rapid re-poll count and check threshold
  const count = (_dequeueAfterTimeoutCount.get(sid) ?? 0) + 1;
  _dequeueAfterTimeoutCount.set(sid, count);

  if (count < REPOLL_THRESHOLD) return; // grace: single misfire allowed

  // Already warned for this subscription lifetime (AC5)
  if (_nudgeFiredForSession.has(sid)) return;

  // Threshold reached → warn once per subscription
  _nudgeFiredForSession.add(sid);
  _dequeueAfterTimeoutCount.set(sid, 0);
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.BEHAVIOR_NUDGE_DEQUEUE_PATTERN.text,
    SERVICE_MESSAGES.BEHAVIOR_NUDGE_DEQUEUE_PATTERN.eventType,
  );
}

// ---------------------------------------------------------------------------
// Max-wait:0 drain-and-idle nudge
// ---------------------------------------------------------------------------

/** Per-session state for the max_wait:0-with-active-subscription nudge. */
interface MaxWait0State {
  /** Number of max_wait:0 calls since the subscription was last armed. */
  count: number;
  /** Whether the nudge has already fired this subscription lifetime (no spam). */
  nudgeFired: boolean;
}

/** Per-session nudge tracking Map. */
const _maxWait0State = new Map<number, MaxWait0State>();

/**
 * Reset the per-session max_wait:0 nudge state.
 * Call this when a subscription is armed (activity/listen or activity/file/create)
 * to give the agent a fresh grace window on each new subscription lifetime.
 */
export function resetMaxWait0NudgeState(sid: number): void {
  _maxWait0State.delete(sid);
}

/** Remove per-session nudge state on session close (prevents unbounded Map growth). */
export function removeMaxWait0State(sid: number): void {
  _maxWait0State.delete(sid);
}

/** Exported for test reset only — do not call in production code. */
export function _resetMaxWait0StateForTest(): void {
  _maxWait0State.clear();
}

/**
 * Detect the drain-and-idle anti-pattern: dequeue(max_wait: 0) called while
 * an activity subscription (SSE or file-watch) is active.
 *
 * - 1st call per subscription lifetime: increment counter, no nudge (startup drain grace).
 * - 2nd+ call, nudge not yet fired: inject behavior_nudge and mark as fired.
 * - Nudge already fired: no-op (no spam).
 * - No active subscription: no-op (instant polls are valid without a subscription).
 *
 * Never throws. Never alters dequeue semantics or latency.
 */
function checkMaxWait0Nudge(sid: number): void {
  if (sid <= 0) return;
  if (!isSseMonitorActive(sid) && !isActivityFileActive(sid)) return;

  const existing = _maxWait0State.get(sid) ?? { count: 0, nudgeFired: false };
  const state: MaxWait0State = { count: existing.count + 1, nudgeFired: existing.nudgeFired };
  _maxWait0State.set(sid, state);

  if (state.count <= 1) return; // First call — startup drain grace
  if (state.nudgeFired) return; // Already nudged this subscription lifetime

  state.nudgeFired = true;
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.BEHAVIOR_NUDGE_MAX_WAIT_ZERO_WITH_SUBSCRIPTION.text,
    SERVICE_MESSAGES.BEHAVIOR_NUDGE_MAX_WAIT_ZERO_WITH_SUBSCRIPTION.eventType,
  );
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
  "`{ pending? }` for instant polls (max_wait: 0); " +
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

  // Count every dequeue attempt (including idle/empty polls) for runaway-loop detection.
  checkDequeueRate(sid, Date.now());

  // Mark this session as having an in-flight dequeue — suppresses activity-file notifications
  // while the agent is actively waiting for messages.
  // Set here: after session existence confirmed, before any deliverServiceMessage calls,
  // so onboarding messages do not fire spurious SSE wakeup notifications.
  // Every path through the try/finally below is guaranteed to call setDequeueActive(sid, false).
  setDequeueActive(sid, true);

  // R5: First-dequeue detection for child sessions — inject onboarding before any content drain.
  // Checked here: after setDequeueActive(true), before content reads.
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
    const hints: string[] = [];
    const silenceHint = takeSilenceHint(sid);
    if (silenceHint !== undefined) hints.push(silenceHint);
    const voiceHint = buildVoiceBacklogHint(events, sid);
    if (voiceHint !== undefined) hints.push(voiceHint);
    // Pending-queue nudge: when more messages are waiting, suggest the
    // processing preset so the operator knows the agent sees the backlog.
    if (pending > 0) hints.push(`pending=${pending}; use processing preset.`);
    if (hints.length > 0) result.hint = hints.join(" ");
    return result;
  }

  // Check dequeue-pattern behavioral nudge (10-3028): fires when the session
  // rapid-polls after timed_out with a live monitor subscription. The "messages
  // delivered in window" suppress case is handled organically — when a call
  // returns a batch, the batch-return paths delete _lastTimeoutAt so the next
  // call cannot be in a rapid-repoll window.
  checkDequeuePatternNudge(sid, Date.now());

  // Drain-and-idle nudge: when max_wait:0 is called with an active subscription,
  // inject a behavior_nudge after the first grace call (AC1–AC4 of 10-3030).
  if (timeout === 0) {
    checkMaxWait0Nudge(sid);
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
    _fireThinkingIfActionable(sid, batch);
    dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
    // Immediate-batch return is outside the try/finally below — clear state here.
    setDequeueActive(sid, false);
    _lastTimeoutAt.delete(sid);        // messages delivered — reset rapid-repoll window
    _dequeueAfterTimeoutCount.delete(sid);
    _maxWait0State.delete(sid);        // drain counter resets — not an idle poll anymore
    releaseNotifyDebounce(sid, true); // content-returning exit
    resetChannelCooldown(sid);
    return result;
  }

  if (timeout === 0) {
    // Timeout=0 empty-poll: not content-returning — do NOT release notify debounce.
    setDequeueActive(sid, false);
    return { pending: pendingCountAny() };
  }

  // Block until something arrives or timeout expires.
  // Mark session as idle for fleet visibility (session/idle action).
  const deadline = Date.now() + timeout * 1000;
  const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });
  let _staleWarnSent = false;
  setDequeueIdle(sid, true);
  // Tracks whether this dequeue call exits via a content-returning path.
  // Only content-returning exits release the notify debounce; timeout exits skip.
  let _debounceRelease = false;
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
            _debounceRelease = true;
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
          _fireThinkingIfActionable(sid, batch);
          dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
          _debounceRelease = true;
          _lastTimeoutAt.delete(sid);        // messages delivered — reset rapid-repoll window
          _dequeueAfterTimeoutCount.delete(sid);
          _maxWait0State.delete(sid);        // drain counter resets — not an idle poll anymore
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
        _fireThinkingIfActionable(sid, batch);
        dlog("queue", `dequeue returning sid=${sid} batch=${batch.length} payloadLen=${JSON.stringify(result).length}`);
        _debounceRelease = true;
        _lastTimeoutAt.delete(sid);        // messages delivered — reset rapid-repoll window
        _dequeueAfterTimeoutCount.delete(sid);
        _maxWait0State.delete(sid);        // drain counter resets — not an idle poll anymore
        return result;
      }
    }

    resyncActiveSession();
    const pending = pendingCountAny();
    _debounceRelease = true;  // Release debounce on timeout exits too
    _lastTimeoutAt.set(sid, Date.now());   // record for rapid-repoll detection (10-3028)
    flushPendingChannelNotify(sid);
    return { timed_out: true, ...(pending > 0 ? { pending } : {}) };
  } finally {
    // Note: if two concurrent dequeue calls share the same sid (unusual but
    // possible), the second finally will clear the idle flag while the first
    // is still waiting. This is acceptable — the session is not fully idle in
    // that case. A refcount would be needed to handle it precisely.
    setDequeueIdle(sid, false);
    setDequeueActive(sid, false);
    // Release notify debounce on all dequeue exits (content-returning and timeout).
    if (_debounceRelease) {
      releaseNotifyDebounce(sid, true); // content-returning or timeout exit
      resetChannelCooldown(sid);
    }
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
