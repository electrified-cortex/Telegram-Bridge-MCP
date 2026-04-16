/**
 * Per-session behavior tracker.
 *
 * Tracks agent behavior metrics per session and injects corrective service
 * message nudges when behavior drifts. Designed to be side-effect-free and
 * fully mockable — no live bridge required for testing.
 *
 * Metrics tracked:
 *   1. show-typing rate: % of `send` calls preceded by show_typing within 10s
 *   2. dequeue-to-send gap: time from last dequeue to first outbound action
 *   3. reaction usage: whether the agent reacted to the first user message
 *   4. animation usage: whether animation/typing fired after receiving messages
 *
 * Nudge rules:
 *   - show-typing rate < 30% after 5+ sends → inject typing nudge
 *   - dequeue-to-send gap > 8s with no activity for 2+ messages → inject gap nudge
 *   - On first user message → inject reaction reminder
 *
 * Cap: max 3 nudges per session total. After cap, tracker stops injecting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionBehaviorState {
  /** Total number of `send` calls (any type that reaches the user). */
  sendCount: number;

  /** Number of `send` calls that were preceded by a show_typing within 10s. */
  typingBeforeSendCount: number;

  /** Timestamp of the last show_typing call (ms since epoch). */
  lastTypingAt: number | undefined;

  /** Timestamp of the last show_animation call (ms since epoch). */
  lastAnimationAt: number | undefined;

  /** Timestamp when the last user message was dequeued (ms since epoch). */
  lastDequeueAt: number | undefined;

  /** Number of consecutive user messages where gap exceeded threshold with no activity. */
  slowGapCount: number;

  /** Whether any activity occurred after dequeue (typing/reaction/animation/send). */
  hadActivityAfterDequeue: boolean;

  /** Whether the first user message has been seen in this session. */
  firstUserMessageSeen: boolean;

  /** Whether the first-message reaction nudge has fired. */
  firstMessageNudgeFired: boolean;

  /** Whether the typing-rate nudge has fired. */
  typingNudgeFired: boolean;

  /** Whether the slow-gap nudge has fired. */
  gapNudgeFired: boolean;

  /** Total nudges injected this session. */
  nudgeCount: number;

  /** Seconds waited before last first-outbound-action (for nudge message). */
  lastGapSeconds: number;
}

/** Function type for injecting service message nudges into a session. */
export type NudgeInjector = (sid: number, text: string, eventType: string) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Window in ms within which a show_typing must precede a send to count as "typed". */
const TYPING_WINDOW_MS = 10_000;

/** Minimum number of sends before the typing-rate nudge can fire. */
const MIN_SENDS_FOR_TYPING_NUDGE = 5;

/** Minimum typing rate (0–1) to avoid a nudge. Below this → inject nudge. */
const TYPING_RATE_THRESHOLD = 0.30;

/** Gap in seconds from last dequeue before a nudge fires (no activity). */
const GAP_THRESHOLD_SECONDS = 8;

/** Number of consecutive slow messages before gap nudge fires. */
const CONSECUTIVE_SLOW_FOR_NUDGE = 2;

/** Maximum nudges injected per session. */
const MAX_NUDGES_PER_SESSION = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const _sessions = new Map<number, SessionBehaviorState>();

/** Injector function for nudges — defaults to deliverServiceMessage but replaceable in tests. */
let _nudgeInjector: NudgeInjector = () => {
  // Default no-op — replaced by server integration via setNudgeInjector().
  // Tests can also replace with a spy.
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Set the function used to inject nudges into a session queue.
 * In production, wire to `deliverServiceMessage` from session-queue.ts.
 * In tests, wire to a spy/mock.
 */
export function setNudgeInjector(fn: NudgeInjector): void {
  _nudgeInjector = fn;
}

/**
 * Initialize tracking state for a new session.
 * Safe to call multiple times — already-initialized sessions are a no-op.
 */
export function initSession(sid: number): void {
  if (_sessions.has(sid)) return;
  _sessions.set(sid, {
    sendCount: 0,
    typingBeforeSendCount: 0,
    lastTypingAt: undefined,
    lastAnimationAt: undefined,
    lastDequeueAt: undefined,
    slowGapCount: 0,
    hadActivityAfterDequeue: false,
    firstUserMessageSeen: false,
    firstMessageNudgeFired: false,
    typingNudgeFired: false,
    gapNudgeFired: false,
    nudgeCount: 0,
    lastGapSeconds: 0,
  });
}

/**
 * Remove tracking state when a session ends.
 */
export function removeSession(sid: number): void {
  _sessions.delete(sid);
}

/** Get a session's state (undefined if not initialized). */
export function getSessionState(sid: number): SessionBehaviorState | undefined {
  return _sessions.get(sid);
}

// ---------------------------------------------------------------------------
// Nudge helpers
// ---------------------------------------------------------------------------

/** Check whether the per-session nudge cap has been reached. */
function canNudge(state: SessionBehaviorState): boolean {
  return state.nudgeCount < MAX_NUDGES_PER_SESSION;
}

/** Inject a nudge and increment the session's nudge counter. */
function inject(sid: number, state: SessionBehaviorState, text: string, eventType: string): void {
  if (!canNudge(state)) return;
  state.nudgeCount++;
  _nudgeInjector(sid, text, eventType);
}

// ---------------------------------------------------------------------------
// Event recording
// ---------------------------------------------------------------------------

/**
 * Record that a dequeue returned at least one user message (inbound content).
 * Must be called when dequeue yields user content events.
 * @param sid Session ID
 * @param hasUserMessage True if the dequeued batch contained a user content event
 * @param now Optional timestamp override (for testing)
 */
export function recordDequeue(sid: number, hasUserMessage: boolean, now: number = Date.now()): void {
  const state = _sessions.get(sid);
  if (!state) return;

  if (!hasUserMessage) return;

  // --- First user message nudge ---
  if (!state.firstUserMessageSeen) {
    state.firstUserMessageSeen = true;
    if (!state.firstMessageNudgeFired && canNudge(state)) {
      state.firstMessageNudgeFired = true;
      inject(
        sid,
        state,
        "This is your first message from the operator. React to acknowledge (message_id is in the update). 👀 = processing, 👍 = on it.",
        "behavior_nudge_first_message",
      );
    }
  }

  // --- Dequeue-to-send gap tracking ---
  // Check gap from *previous* dequeue (if we haven't yet had the first activity).
  if (state.lastDequeueAt !== undefined && !state.hadActivityAfterDequeue) {
    const gapMs = now - state.lastDequeueAt;
    const gapSec = gapMs / 1000;
    if (gapSec > GAP_THRESHOLD_SECONDS) {
      state.slowGapCount++;
      state.lastGapSeconds = Math.round(gapSec);
    } else {
      state.slowGapCount = 0;
    }
  } else {
    // Activity occurred after last dequeue — reset slow count
    state.slowGapCount = 0;
  }

  // Record new dequeue timestamp and reset activity flag
  state.lastDequeueAt = now;
  state.hadActivityAfterDequeue = false;

  // --- Gap nudge ---
  if (!state.gapNudgeFired && state.slowGapCount >= CONSECUTIVE_SLOW_FOR_NUDGE && canNudge(state)) {
    state.gapNudgeFired = true;
    inject(
      sid,
      state,
      `The operator waited ${state.lastGapSeconds}s with no feedback. Signal activity sooner.`,
      "behavior_nudge_slow_gap",
    );
  }
}

/**
 * Record a show_typing call (or any typing-indicator activity).
 * @param sid Session ID
 * @param now Optional timestamp override (for testing)
 */
export function recordTyping(sid: number, now: number = Date.now()): void {
  const state = _sessions.get(sid);
  if (!state) return;
  state.lastTypingAt = now;
  state.hadActivityAfterDequeue = true;
}

/**
 * Record a show_animation call.
 * @param sid Session ID
 * @param now Optional timestamp override (for testing)
 */
export function recordAnimation(sid: number, now: number = Date.now()): void {
  const state = _sessions.get(sid);
  if (!state) return;
  state.lastAnimationAt = now;
  state.hadActivityAfterDequeue = true;
}

/**
 * Record a set_reaction call.
 * @param sid Session ID
 */
export function recordReaction(sid: number): void {
  const state = _sessions.get(sid);
  if (!state) return;
  state.hadActivityAfterDequeue = true;
}

/**
 * Record a send call (any type that produces outbound content).
 * Checks the typing window and evaluates the typing-rate nudge.
 * @param sid Session ID
 * @param now Optional timestamp override (for testing)
 */
export function recordSend(sid: number, now: number = Date.now()): void {
  const state = _sessions.get(sid);
  if (!state) return;

  state.sendCount++;
  state.hadActivityAfterDequeue = true;

  // Determine whether show_typing preceded this send within the window
  const typingWithinWindow =
    state.lastTypingAt !== undefined &&
    now - state.lastTypingAt <= TYPING_WINDOW_MS;

  if (typingWithinWindow) {
    state.typingBeforeSendCount++;
  }

  // Typing-rate nudge: only after MIN_SENDS_FOR_TYPING_NUDGE sends
  if (!state.typingNudgeFired && state.sendCount >= MIN_SENDS_FOR_TYPING_NUDGE) {
    const rate = state.typingBeforeSendCount / state.sendCount;
    if (rate < TYPING_RATE_THRESHOLD && canNudge(state)) {
      state.typingNudgeFired = true;
      inject(
        sid,
        state,
        "Use show_typing after receiving messages to signal you're working.",
        "behavior_nudge_typing_rate",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

/** Reset all tracker state. For tests only. */
export function resetBehaviorTrackerForTest(): void {
  _sessions.clear();
  _nudgeInjector = () => {};
}
