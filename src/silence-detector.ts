/**
 * Silent-work presence detector.
 *
 * Runs a background timer and emits service-message nudges when a session
 * has been silent for too long while an operator event is pending.
 *
 * Escalation rungs (while pending operator content exists):
 *   < 30 s  → nothing
 *   30–60 s → rung-1 nudge (consider show-typing / reaction / animation)
 *   60 s+   → rung-2 nudge (stronger wording, names animation presets)
 *
 * Any outbound signal (detected via lastOutboundAt change in behavior-tracker)
 * resets the silence clock and rung state for the next episode.
 *
 * Active animations suppress all nudges — they are sufficient presence signals.
 */

import { listSessions } from "./session-manager.js";
import { getSessionState } from "./behavior-tracker.js";
import { hasPendingUserContent, getPendingUserContentSince } from "./session-queue.js";
import { hasActiveAnimation } from "./animation-state.js";
import { SERVICE_MESSAGES } from "./service-messages.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds of silence before rung-1 nudge (pending operator content required). */
const RUNG_1_THRESHOLD_S = 30;

/** Seconds of silence before rung-2 (stronger) nudge. */
const RUNG_2_THRESHOLD_S = 60;

/** How often the background timer fires (seconds). Must be < RUNG_1_THRESHOLD_S. */
const CHECK_INTERVAL_S = 10;

/** Grace period after session creation before the detector activates (ms). */
const STARTUP_GRACE_MS = 30_000;

// ---------------------------------------------------------------------------
// Per-session rung state
// ---------------------------------------------------------------------------

interface SilenceState {
  /** Whether the rung-1 nudge has been injected in the current silence episode. */
  rung1Fired: boolean;
  /** Whether the rung-2 nudge has been injected in the current silence episode. */
  rung2Fired: boolean;
  /**
   * The lastOutboundAt value observed last tick.
   * When this changes, a new episode has started — reset rung flags.
   */
  lastKnownOutboundAt: number | undefined;
  /**
   * The pendingSince value observed last tick.
   * When this advances, the operator sent a new message — reset rung flags.
   */
  lastKnownPendingSince: number | undefined;
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

    // Scope guard: only nudge when there is pending operator input
    if (!hasPendingUserContent(sid)) continue;

    // Animation guard: agent is showing presence via animation
    if (hasActiveAnimation(sid)) continue;

    // Read last outbound signal timestamp from behavior tracker
    const behaviorState = getSessionState(sid);
    const currentOutboundAt = behaviorState?.lastOutboundAt;

    // Get or create per-session rung state
    let state = _states.get(sid);
    if (!state) {
      state = { rung1Fired: false, rung2Fired: false, lastKnownOutboundAt: undefined, lastKnownPendingSince: undefined };
      _states.set(sid, state);
    }

    // Episode reset: only when the outbound timestamp advances — a genuinely new
    // signal was sent. Backward/equal moves (clock drift, test-mock quirks) are
    // ignored so a stale value doesn't falsely clear the rung-2 window.
    if (currentOutboundAt !== undefined) {
      const isNew = state.lastKnownOutboundAt !== undefined
        && currentOutboundAt > state.lastKnownOutboundAt;
      if (isNew) {
        state.rung1Fired = false;
        state.rung2Fired = false;
      }
      if (state.lastKnownOutboundAt === undefined || currentOutboundAt > state.lastKnownOutboundAt) {
        state.lastKnownOutboundAt = currentOutboundAt;
      }
    }

    // Compute elapsed silence. Anchor to the more recent of: last outbound signal
    // or when the current pending inbound content arrived. This ensures a fresh
    // 30s grace window starts whenever the operator sends a new message, even if
    // the last outbound was minutes ago.
    const pendingSince = getPendingUserContentSince(sid);

    // Episode reset: when the operator sends a new message (pendingSince advances),
    // clear rung state so nudges can fire again in the fresh episode.
    if (pendingSince !== undefined) {
      const isNewInbound = state.lastKnownPendingSince !== undefined
        && pendingSince > state.lastKnownPendingSince;
      if (isNewInbound) {
        state.rung1Fired = false;
        state.rung2Fired = false;
      }
      if (state.lastKnownPendingSince === undefined || pendingSince > state.lastKnownPendingSince) {
        state.lastKnownPendingSince = pendingSince;
      }
    }

    const base = Math.max(
      currentOutboundAt ?? createdAtMs,
      pendingSince ?? createdAtMs,
    );
    const elapsed = Math.floor((now - base) / 1000);

    if (elapsed < RUNG_1_THRESHOLD_S) continue;

    if (!state.rung2Fired && elapsed >= RUNG_2_THRESHOLD_S) {
      if (!state.rung1Fired) {
        state.rung1Fired = true;
      }
      _nudgeInjector(
        sid,
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG2.text(elapsed),
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG2.eventType,
      );
      state.rung2Fired = true;
    } else if (!state.rung1Fired && elapsed >= RUNG_1_THRESHOLD_S) {
      _nudgeInjector(
        sid,
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG1.text(elapsed),
        SERVICE_MESSAGES.NUDGE_PRESENCE_RUNG1.eventType,
      );
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
