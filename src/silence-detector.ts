/**
 * Silent-work presence detector.
 *
 * Runs a background timer and emits presence nudges when a session has been
 * silent after dequeuing a user message with no acknowledgement signal.
 *
 * Trigger: silence window opens when the agent dequeues a message (any content
 * type). It does NOT open during dequeue-idle-wait (empty/timed_out responses).
 *
 * Cleared by: any acknowledgement signal (show-typing, reaction, animation
 * start, or any outbound message on the same session).
 *
 * Escalation rungs (since last dequeue, while no ack has been emitted):
 *   < threshold s     → nothing (default: 30 s, floor: 15 s, configurable)
 *   threshold s       → rung-1: envelope hint on next dequeue response
 *   threshold × 2 s   → rung-2: service message (heavier weight)
 *
 * Rung state resets on each new dequeue (per-dequeue episode).
 * Active animations suppress all nudges.
 */

import { listSessions } from "./session-manager.js";
import { setSilenceHint, getSilenceThreshold } from "./session-manager.js";
import { getSessionState } from "./behavior-tracker.js";
import { hasActiveAnimation } from "./animation-state.js";
import { SERVICE_MESSAGES } from "./service-messages.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often the background timer fires (seconds). Must be < minimum threshold (15 s). */
const CHECK_INTERVAL_S = 10;

/** Grace period after session creation before the detector activates (ms). */
const STARTUP_GRACE_MS = 30_000;

// ---------------------------------------------------------------------------
// Per-session rung state
// ---------------------------------------------------------------------------

interface SilenceState {
  /** Whether the rung-1 hint has been injected in the current silence episode. */
  rung1Fired: boolean;
  /** Whether the rung-2 nudge has been injected in the current silence episode. */
  rung2Fired: boolean;
  /**
   * The lastDequeueAt value observed at the previous tick.
   * When this advances, a new episode has started — reset rung flags.
   */
  lastKnownDequeueAt: number | undefined;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const _states = new Map<number, SilenceState>();
const _optedOut = new Set<number>();
let _timer: ReturnType<typeof setInterval> | undefined;
let _nudgeInjector: ((sid: number, text: string, eventType: string) => void) | undefined;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Wire the nudge delivery function. In production, called from server.ts
 * to deliver nudges via deliverServiceMessage. In tests, wire a spy.
 */
export function setPresenceNudgeInjector(
  fn: (sid: number, text: string, eventType: string) => void,
): void {
  _nudgeInjector = fn;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the silence detector background timer.
 * Safe to call multiple times — replaces any existing timer.
 */
export function startSilenceDetector(intervalMs = CHECK_INTERVAL_S * 1000): void {
  stopSilenceDetector();
  _timer = setInterval(() => {
    _runSilenceDetectorTickForTest();
  }, intervalMs);
  // Allow the process to exit even if this timer is running.
  if (typeof _timer.unref === "function") _timer.unref();
}

/**
 * Stop the silence detector background timer and clear per-session rung state.
 * Opt-out registrations (`_optedOut`) are preserved — governor opt-out decisions
 * survive timer restarts by design.
 */
export function stopSilenceDetector(): void {
  if (_timer !== undefined) {
    clearInterval(_timer);
    _timer = undefined;
  }
  _states.clear();
}

/**
 * Enable or disable nudges for a specific session (governor-only action).
 * Opt-out is session-scoped and in-memory only.
 */
export function setSilenceDetectorOptOut(sid: number, disabled: boolean): void {
  if (disabled) _optedOut.add(sid);
  else _optedOut.delete(sid);
}

/** Returns true if the session has opted out of silence nudges. */
export function isSilenceDetectorOptOut(sid: number): boolean {
  return _optedOut.has(sid);
}

/** Remove all state for a session (call on session close). Safe for unknown sids. */
export function removeSilenceState(sid: number): void {
  _states.delete(sid);
  _optedOut.delete(sid);
}

// ---------------------------------------------------------------------------
// Tick logic (exposed for deterministic testing)
// ---------------------------------------------------------------------------

/**
 * Run one detector tick. Exported for tests — not for production callers
 * outside this module.
 *
 * @param now Current timestamp in ms (defaults to Date.now()).
 */
export function _runSilenceDetectorTickForTest(now = Date.now()): void {
  if (!_nudgeInjector) return;

  for (const session of listSessions()) {
    const sid = session.sid;

    // Opt-out guard
    if (_optedOut.has(sid)) continue;

    // Startup grace: don't nudge freshly created sessions
    const createdAtMs = new Date(session.createdAt).getTime();
    if (createdAtMs + STARTUP_GRACE_MS > now) continue;

    // Animation guard: agent is showing presence via animation
    if (hasActiveAnimation(sid)) continue;

    // Read behavior state: last dequeue and last outbound signal
    const behaviorState = getSessionState(sid);
    const lastDequeueAt = behaviorState?.lastDequeueAt;
    const lastOutboundAt = behaviorState?.lastOutboundAt;

    // Window guard: only open when agent has dequeued a user message
    if (lastDequeueAt === undefined) continue;

    // Window guard: closed when agent has already acked after last dequeue
    if (lastOutboundAt !== undefined && lastOutboundAt >= lastDequeueAt) continue;

    // Get or create per-session rung state
    let state = _states.get(sid);
    if (!state) {
      state = { rung1Fired: false, rung2Fired: false, lastKnownDequeueAt: undefined };
      _states.set(sid, state);
    }

    // Episode reset: when lastDequeueAt advances, a new dequeue episode began.
    // Reset rungs so nudges can fire again in the fresh episode.
    const isNewDequeue = state.lastKnownDequeueAt !== undefined
      && lastDequeueAt > state.lastKnownDequeueAt;
    if (isNewDequeue) {
      state.rung1Fired = false;
      state.rung2Fired = false;
    }
    if (state.lastKnownDequeueAt === undefined || lastDequeueAt > state.lastKnownDequeueAt) {
      state.lastKnownDequeueAt = lastDequeueAt;
    }

    // Elapsed since last dequeue
    const elapsed = Math.floor((now - lastDequeueAt) / 1000);
    const threshold = getSilenceThreshold(sid);

    if (elapsed < threshold) continue;

    if (!state.rung2Fired && elapsed >= threshold * 2) {
      // Rung-1 is superseded — mark fired without emitting hint
      if (!state.rung1Fired) {
        state.rung1Fired = true;
      }
      _nudgeInjector(
        sid,
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG2.text(elapsed),
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG2.eventType,
      );
      state.rung2Fired = true;
    } else if (!state.rung1Fired && elapsed >= threshold) {
      // Rung-1: lightweight envelope hint (no service message)
      setSilenceHint(sid, `silence: ${elapsed}s since last dequeue; operator sees no progress`);
      state.rung1Fired = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all detector state. For tests only. */
export function resetSilenceDetectorForTest(): void {
  _states.clear();
  _optedOut.clear();
  if (_timer !== undefined) {
    clearInterval(_timer);
    _timer = undefined;
  }
  _nudgeInjector = undefined;
}
