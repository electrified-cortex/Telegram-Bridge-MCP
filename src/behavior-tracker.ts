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
 *   5. button usage: whether the agent uses confirm/choose buttons for questions
 *
 * Nudge rules:
 *   - show-typing rate < 30% after 5+ sends → inject typing nudge
 *   - dequeue-to-send gap > 8s with no activity for 2+ messages → inject gap nudge
 *   - On first user message → inject reaction reminder
 *   - First actionable ? question without buttons → lightweight hint nudge
 *   - 10+ actionable ? questions without buttons → escalation nudge
 *
 * Cap: max 5 nudges per session total. After cap, tracker stops injecting.
 */

import { SERVICE_MESSAGES } from "./service-messages.js";

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

  /** Number of actionable ? messages sent without buttons. */
  questionWithoutButtonCount: number;

  /** Once true, suppress all button nudges for this session. */
  knowsButtons: boolean;

  /** Whether the lightweight first-question hint has fired. */
  questionHintFired: boolean;

  /** Whether the 10-question escalation nudge has fired. */
  questionEscalationFired: boolean;

  /** Timestamp of the last outbound presence signal (typing, animation, reaction, send). */
  lastOutboundAt: number | undefined;
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
const MAX_NUDGES_PER_SESSION = 5;

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
    questionWithoutButtonCount: 0,
    knowsButtons: false,
    questionHintFired: false,
    questionEscalationFired: false,
    lastOutboundAt: undefined,
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
function inject(
  sid: number,
  state: SessionBehaviorState,
  entry: { text: string; eventType: string },
): void {
  if (!canNudge(state)) return;
  state.nudgeCount++;
  _nudgeInjector(sid, entry.text, entry.eventType);
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
      inject(sid, state, SERVICE_MESSAGES.NUDGE_FIRST_MESSAGE);
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
    inject(sid, state, SERVICE_MESSAGES.NUDGE_SLOW_GAP);
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
      inject(sid, state, SERVICE_MESSAGES.NUDGE_TYPING_RATE);
    }
  }
}

// ---------------------------------------------------------------------------
// Button / question tracking
// ---------------------------------------------------------------------------

const BINARY_QUESTION_PREFIXES = /^(would you|should i|do you|can i|is this|are you|shall i|will you|ready to|ok to)/i;
const OPENENDED_PREFIXES = /^(what if|how does|why does|i wonder|interesting|note that|remember that)/i;

function looksLikeActionableQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) return false;
  if (trimmed.includes("```")) return false;   // skip code blocks
  if (trimmed.length > 200) return false;       // skip long rhetorical sentences
  if (BINARY_QUESTION_PREFIXES.test(trimmed)) return true;
  if (OPENENDED_PREFIXES.test(trimmed)) return false;
  return true;  // short ? ending = likely actionable
}

/**
 * Record that the agent used a button-style interaction (confirm, choose, etc.).
 * Once called, all future button nudges for this session are suppressed.
 * @param sid Session ID
 */
export function recordButtonUse(sid: number): void {
  const state = _sessions.get(sid);
  if (!state) return;
  state.knowsButtons = true;
}

/**
 * Record an outbound text send. If the text looks like an actionable question
 * and the agent has not demonstrated button awareness, inject a nudge.
 * @param sid Session ID
 * @param text The outbound message text
 */
export function recordOutboundText(sid: number, text: string): void {
  const state = _sessions.get(sid);
  if (!state) return;

  // If the agent already uses buttons, suppress all button nudges.
  if (state.knowsButtons) return;

  if (!looksLikeActionableQuestion(text)) return;

  state.questionWithoutButtonCount++;

  if (!state.questionHintFired && state.questionWithoutButtonCount === 1 && canNudge(state)) {
    state.questionHintFired = true;
    inject(sid, state, SERVICE_MESSAGES.NUDGE_QUESTION_HINT);
  }

  if (!state.questionEscalationFired && state.questionWithoutButtonCount >= 10 && canNudge(state)) {
    state.questionEscalationFired = true;
    inject(sid, state, SERVICE_MESSAGES.NUDGE_QUESTION_ESCALATION);
  }
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

/**
 * Record any outbound presence signal — resets the silence clock.
 * Called from server.ts middleware for: show_typing (non-cancel),
 * show_animation, set_reaction, and send (non-DM types).
 */
export function recordPresenceSignal(sid: number, now: number = Date.now()): void {
  const state = _sessions.get(sid);
  if (!state) return;
  state.lastOutboundAt = now;
}

/** Reset all tracker state. For tests only. */
export function resetBehaviorTrackerForTest(): void {
  _sessions.clear();
  _nudgeInjector = () => {};
}
