/**
 * Per-session Thinking indicator manager (Stage 1 — plain `sendMessageDraft`).
 *
 * Fires Telegram's native "Thinking…" draft bubble automatically when an
 * actionable operator message is dequeued. The bubble auto-expires after
 * ~30 s (Telegram-native). For longer holds the bridge autonomously refreshes
 * the draft within each 30-second window.
 *
 * ## Hold semantics (floor-not-cap)
 *   hold-until = max(hold-until, now + 30s)
 *   A refresh *tops up* a near-expiry hold but NEVER shortens a longer one.
 *
 * ## Supersession (allow-list — default DON'T cancel)
 *   Cancelled by:   send (text/file/voice/notify/dm), choice/question/confirm/
 *                   checklist/progress, show_typing/TTS record, animation show
 *   Refreshed by:   another actionable dequeue (floor bump only)
 *   Leaves up:      help, download, transcribe, chat/info, message/get/history,
 *                   session/*, profile/*, reminder/*, log/*, activity/*,
 *                   commands/set, react, message/pin/edit/delete
 *
 * ## Draft early-dismissal (Stage 1 spike resolved)
 *   Sending a real message auto-supersedes the Thinking bubble visually —
 *   Telegram shows the sent message in the chat; the draft disappears from
 *   the "composing" slot. No explicit draft-delete API call is required for
 *   clean visual supersession. We clear our internal state; the Telegram
 *   draft expires naturally within its 30-second TTL if not overwritten.
 */

import { getApi, resolveChat } from "./telegram.js";

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Default hold duration (ms) — matches Telegram's native draft TTL (~30 s). */
export const DEFAULT_HOLD_MS = 30_000;

/** Refresh fires this many ms *before* the hold deadline to avoid a visible gap. */
const REFRESH_BUFFER_MS = 4_000;

/** How often to cycle through phases (ms). */
const PHASE_CYCLE_MS = 8_000;

// ---------------------------------------------------------------------------
// Global draft-ID counter
// ---------------------------------------------------------------------------

/** Monotonically increasing counter for client-generated draft IDs. */
let _draftIdCounter = 1_000_000;

function nextDraftId(): number {
  return ++_draftIdCounter;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ThinkingState {
  /** Epoch ms at which the hold expires (= when we stop refreshing). */
  holdUntil: number;
  /** Client-generated ID for the current draft session. */
  draftId: number;
  /** Resolved chat ID (captured at fire time for use in async timers). */
  chatId: number;
  /** Whether the Thinking bubble is currently live. */
  active: boolean;
  /** Optional custom label text (plain draft shows it as draft body). */
  label?: string;
  /** Optional phase scripts cycled by the bridge timer. */
  phases?: string[];
  /** Index into phases[] for the next cycle. */
  phaseIndex: number;
  /** Timer that re-fires the draft near the hold deadline. */
  refreshTimer?: ReturnType<typeof setTimeout>;
  /** Timer that cycles through phases. */
  phaseTimer?: ReturnType<typeof setInterval>;
}

const _states = new Map<number, ThinkingState>();

function _get(sid: number): ThinkingState | undefined {
  return _states.get(sid);
}

function _getOrCreate(sid: number, chatId: number): ThinkingState {
  let s = _states.get(sid);
  if (!s) {
    s = {
      holdUntil: 0,
      draftId: nextDraftId(),
      chatId,
      active: false,
      phaseIndex: 0,
    };
    _states.set(sid, s);
  }
  return s;
}

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if ("unref" in t) {
    (t as { unref(): void }).unref();
  }
}

// ---------------------------------------------------------------------------
// Draft text helpers
// ---------------------------------------------------------------------------

/**
 * Current draft body text for a state entry.
 * Empty string → Telegram shows the native "Thinking…" bubble.
 * Non-empty → shown as a draft message preview (best-effort for phases).
 */
function currentDraftText(s: ThinkingState): string {
  if (s.phases && s.phases.length > 0) {
    return s.phases[s.phaseIndex % s.phases.length] ?? "";
  }
  return s.label ?? "";
}

// ---------------------------------------------------------------------------
// Core send — best-effort, never throws
// ---------------------------------------------------------------------------

async function _sendDraft(chatId: number, draftId: number, text: string): Promise<void> {
  try {
    await getApi().sendMessageDraft(chatId, draftId, text);
  } catch {
    // Best-effort — never surface errors to the caller.
    // Draft sends are non-critical presence indicators.
  }
}

// ---------------------------------------------------------------------------
// Refresh scheduler
// ---------------------------------------------------------------------------

/**
 * Schedule a refresh for `sid` if the hold extends beyond one 30-second
 * Telegram TTL window. Clears any previously scheduled refresh first.
 *
 * The refresh fires REFRESH_BUFFER_MS before the hold deadline, re-sends
 * the draft, and schedules the next refresh if the hold still extends
 * further than another full TTL.
 */
function _scheduleRefresh(sid: number): void {
  const s = _states.get(sid);
  if (!s || !s.active) return;

  // Clear existing refresh timer
  if (s.refreshTimer !== undefined) {
    clearTimeout(s.refreshTimer);
    s.refreshTimer = undefined;
  }

  const remaining = s.holdUntil - Date.now();
  // Only schedule if there's enough time to merit a refresh
  if (remaining <= REFRESH_BUFFER_MS) return;

  const fireIn = remaining - REFRESH_BUFFER_MS;
  s.refreshTimer = setTimeout(() => {
    const curr = _states.get(sid);
    if (!curr || !curr.active || Date.now() >= curr.holdUntil) {
      // Hold expired — cancel cleanly
      _cancelState(sid, false);
      return;
    }
    // Re-send draft to keep it alive
    void _sendDraft(curr.chatId, curr.draftId, currentDraftText(curr));
    // Schedule next refresh if hold still continues
    _scheduleRefresh(sid);
  }, fireIn);
  unrefTimer(s.refreshTimer);
}

// ---------------------------------------------------------------------------
// Phase cycling
// ---------------------------------------------------------------------------

function _startPhaseCycle(sid: number): void {
  const s = _states.get(sid);
  if (!s || !s.phases || s.phases.length < 2) return;

  // Clear any existing phase timer
  _stopPhaseCycle(sid);

  s.phaseTimer = setInterval(() => {
    const curr = _states.get(sid);
    if (!curr || !curr.active || !curr.phases || curr.phases.length < 2) {
      _stopPhaseCycle(sid);
      return;
    }
    curr.phaseIndex = (curr.phaseIndex + 1) % curr.phases.length;
    void _sendDraft(curr.chatId, curr.draftId, currentDraftText(curr));
  }, PHASE_CYCLE_MS);
  unrefTimer(s.phaseTimer);
}

function _stopPhaseCycle(sid: number): void {
  const s = _states.get(sid);
  if (!s) return;
  if (s.phaseTimer !== undefined) {
    clearInterval(s.phaseTimer);
    s.phaseTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Internal cancel (does NOT send a dismiss request — see spike notes above)
// ---------------------------------------------------------------------------

function _cancelState(sid: number, deleteEntry: boolean): void {
  const s = _states.get(sid);
  if (!s) return;

  if (s.refreshTimer !== undefined) {
    clearTimeout(s.refreshTimer);
    s.refreshTimer = undefined;
  }
  _stopPhaseCycle(sid);
  s.active = false;
  s.holdUntil = 0;

  if (deleteEntry) {
    _states.delete(sid);
  }
}

// ---------------------------------------------------------------------------
// Public API — production
// ---------------------------------------------------------------------------

/**
 * Call when a dequeue returns actionable operator content for `sid`.
 *
 * - If Thinking is NOT active: fire the draft and start a new 30-second hold.
 * - If Thinking IS active: apply floor bump —
 *     hold-until = max(hold-until, now + 30s)
 *   If the remaining hold was less than 30s (near expiry), tops it up and
 *   re-fires the draft. If the remaining hold was already ≥ 30s (agent-extended),
 *   the hold is unchanged and no draft re-send is needed for the new bump.
 *
 * Best-effort: never throws. Fire-and-forget from `runDrainLoop`.
 */
export async function onActionableDequeue(sid: number): Promise<void> {
  try {
    const chatIdRaw = resolveChat();
    if (typeof chatIdRaw !== "number") return; // ALLOWED_USER_ID not configured

    const now = Date.now();
    const newFloor = now + DEFAULT_HOLD_MS;

    const existing = _get(sid);
    if (existing && existing.active) {
      // Floor bump: only update if it would extend the hold
      if (newFloor > existing.holdUntil) {
        existing.holdUntil = newFloor;
        // Re-send draft to reset Telegram's native 30s TTL window
        await _sendDraft(existing.chatId, existing.draftId, currentDraftText(existing));
        _scheduleRefresh(sid);
      }
      // else: hold is already ≥ 30s from now — no change needed
      return;
    }

    // Not active (or no state) — fire fresh thinking
    const s = _getOrCreate(sid, chatIdRaw);
    s.holdUntil = newFloor;
    s.draftId = nextDraftId(); // fresh draft ID for new thinking period
    s.chatId = chatIdRaw;
    s.active = true;
    s.phaseIndex = 0;
    // Clear any label/phases from a previous extend (clean slate for auto-trigger)
    s.label = undefined;
    s.phases = undefined;

    await _sendDraft(s.chatId, s.draftId, "");
    // Default hold is exactly one Telegram TTL — no refresh timer needed.
    // Telegram expires the draft naturally. Only schedule refresh if holdUntil
    // was extended (which can't happen at this point — it only extends via
    // extendThinking or repeated actionable dequeues within the hold window).
  } catch {
    // Best-effort — dequeue must never be delayed by thinking-state errors
  }
}

/**
 * Cancel the Thinking indicator for `sid`.
 *
 * Called by the outbound proxy when a superseding action fires
 * (send, show_typing, animation, TTS record, etc.).
 *
 * Does NOT attempt to delete the Telegram draft — the draft expires
 * naturally within its 30-second TTL. Visual supersession is handled
 * by the real message appearing in the chat (Stage 1 spike resolution).
 */
export function cancelThinkingForSid(sid: number): void {
  _cancelState(sid, false);
}

/**
 * Check whether the Thinking indicator is currently active for `sid`.
 * Used by tests and the extend action to inspect state.
 */
export function isThinkingActive(sid: number): boolean {
  return _get(sid)?.active === true;
}

/**
 * Agent extension: take over the auto-started Thinking with a custom
 * label, phase script, and/or extended hold duration.
 *
 * - `label`: custom text shown as the draft body ("Analyzing…")
 * - `phases`: array of phase strings cycled by the bridge timer
 * - `hold`: total hold duration in seconds (bridge refreshes autonomously)
 *
 * If Thinking is not currently active, starts it.
 * All fields are optional — omit to keep the current value.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason: string }` on error.
 */
export async function extendThinking(
  sid: number,
  opts: { label?: string; phases?: string[]; hold?: number },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const chatIdRaw = resolveChat();
    if (typeof chatIdRaw !== "number") {
      return { ok: false, reason: "ALLOWED_USER_ID not configured" };
    }

    const holdMs = opts.hold !== undefined ? opts.hold * 1000 : DEFAULT_HOLD_MS;
    const now = Date.now();
    const newHoldUntil = now + holdMs;

    const s = _getOrCreate(sid, chatIdRaw);

    // Update label / phases
    if (opts.label !== undefined) s.label = opts.label;
    if (opts.phases !== undefined) {
      s.phases = opts.phases.length > 0 ? opts.phases : undefined;
      s.phaseIndex = 0;
    }

    // Floor bump (extend is always allowed to set a longer hold)
    s.holdUntil = Math.max(s.holdUntil, newHoldUntil);
    s.chatId = chatIdRaw;

    if (!s.active) {
      // Start fresh
      s.draftId = nextDraftId();
      s.active = true;
    }

    // Stop existing phase cycle (will restart below with updated phases)
    _stopPhaseCycle(sid);

    // Send draft with updated text
    await _sendDraft(s.chatId, s.draftId, currentDraftText(s));

    // Schedule refresh if hold extends past one TTL window
    _scheduleRefresh(sid);

    // Start phase cycle if phases are set
    if (s.phases && s.phases.length >= 2) {
      _startPhaseCycle(sid);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Agent explicit close: cancel the Thinking indicator.
 * Equivalent to `cancelThinkingForSid(sid)` but exported for the tool layer.
 */
export function closeThinking(sid: number): { ok: boolean } {
  _cancelState(sid, false);
  return { ok: true };
}

/**
 * Remove all thinking state for `sid`. Called on session close to prevent
 * unbounded Map growth.
 */
export function removeThinkingState(sid: number): void {
  _cancelState(sid, true);
}

// ---------------------------------------------------------------------------
// Test helpers (exported for white-box testing only)
// ---------------------------------------------------------------------------

/** Reset all thinking state. For testing only. */
export function _resetThinkingStateForTest(): void {
  for (const sid of _states.keys()) {
    _cancelState(sid, false);
  }
  _states.clear();
}

/** Returns the current hold-until timestamp for `sid`. For testing only. */
export function _getHoldUntilForTest(sid: number): number {
  return _get(sid)?.holdUntil ?? 0;
}

/** Returns the current draft ID for `sid`. For testing only. */
export function _getDraftIdForTest(sid: number): number {
  return _get(sid)?.draftId ?? 0;
}

/** Returns the current phases for `sid`. For testing only. */
export function _getPhasesForTest(sid: number): string[] | undefined {
  return _get(sid)?.phases;
}

/** Returns the current label for `sid`. For testing only. */
export function _getLabelForTest(sid: number): string | undefined {
  return _get(sid)?.label;
}
