/**
 * Per-session activity file state.
 *
 * Tracks whether a session has opted into the file-touch feature.
 * On every inbound message (after enqueue), TMCP appends "\n" to the
 * registered file so file-watchers (tail -f, Monitor) can wake the agent.
 *
 * Ownership:
 *   tmcpOwned = true  → TMCP created the file; it will delete it on clear/close.
 *   tmcpOwned = false → agent supplied the path; TMCP never touches lifecycle.
 *
 * Session activity states:
 *   active   — at least one of: inflight dequeue, blocking interactive call, or
 *              a tool call within the kick-debounce window.
 *              Flags: inflightDequeue=true OR lastActivityAt within debounce window.
 *   inactive — none of the above. Reached when:
 *              • Stop hook fires (handleSessionStopped) → immediate transition
 *              • Idle timer expires (kick-debounce window elapsed with no tool calls)
 *
 * Open-gate kick rule:
 *   The kick is gated — it only fires while the session is inactive AND only when
 *   the session queue has pending messages (hasPendingUserContent). This kills the
 *   self-kick loop: Stop hook with no pending messages → no poke.
 *   Gate is OPEN while inactive; inbound messages walk through and poke the file.
 *   Gate is CLOSED while active; the active session will consume messages itself.
 *
 * Poke-debounce (spam prevention within an inactive window):
 *   Even with the gate open, pokes are debounced. Default window = kickDebounceMs.
 *   If we just poked, we don't poke again within the window — the agent already knows.
 *   Tracked via lastTouchAt. lastTouchAt=null means "first poke after reset is free."
 *
 * Stop-hook exception to poke-debounce:
 *   A Stop hook is an active→inactive transition that resets the poke-debounce.
 *   If the queue has pending messages after stop, the poke fires immediately even
 *   if a poke was recent. Operator intent: "if you go inactive and there's still
 *   messages, hey dude, you still got a message."
 *
 * Poke-debounce reset points (lastTouchAt = null → next poke is free):
 *   • setDequeueActive(sid, false) — dequeue cycle complete, re-arm for next message.
 *   • handleSessionStopped(sid)   — Stop hook, active→inactive transition.
 *   • Trailing-timer fires with empty queue — no poke issued; re-arm for next inbound.
 *
 * State machine (nudge cycle):
 *   Armed (nudgeArmed=true) → message arrives → inactive check → poke or schedule timer.
 *   Poke fires → disarm. Timer fires → inactive check → poke or re-arm (empty queue).
 *   Dequeue completion re-arms the cycle. Stop hook re-arms the cycle.
 *
 * Kick-debounce window (kickDebounceMs, per-session via profile/kick-debounce):
 *   Determines when a session is classified inactive. If the last tool call was within
 *   this window, the session is still active and a trailing timer is scheduled.
 *   Tool calls extend lastActivityAt but do NOT cancel a pending timer.
 *
 * Inflight dequeue suppression:
 *   Kicks are skipped while a dequeue call is being processed — the agent
 *   will receive the event directly on dequeue return.
 *
 * lastActivityAt semantics:
 *   Tracks the last tool call time for kick-debounce classification. Reset to 0 by
 *   handleSessionStopped so the next inbound after stop is immediately classified
 *   inactive (no 60 s wait).
 */

import { appendFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { getKickDebounceMs } from "../../session-manager.js";
import { hasPendingUserContent } from "../../session-queue.js";
import { dlog } from "../../debug-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** data/activity/ lives at repo_root/data/activity/ */
const ACTIVITY_DIR = resolve(__dirname, "../../../", "data", "activity");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum debounce floor (hard constraint per spec). */
const DEBOUNCE_FLOOR_MS = 1_000;

/** Default kick debounce window (ms). Per-session override via profile/kick-debounce. */
export const KICK_DEBOUNCE_DEFAULT_MS = 60_000;

/** Minimum allowed kick debounce (ms). */
export const KICK_DEBOUNCE_MIN_MS = 1_000;

/** Maximum allowed kick debounce (ms). */
export const KICK_DEBOUNCE_MAX_MS = 600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityFileState {
  /** Absolute path to the registered file. */
  filePath: string;
  /** True if TMCP created and owns this file. */
  tmcpOwned: boolean;
  /** Timestamp (ms) of the last successful touch, or null if never. */
  lastTouchAt: number | null;
  /** Active kick-delay timer handle, or null if none. */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp (ms) of the last agent tool call (for kick suppression). */
  lastActivityAt: number;
  /** True while a dequeue call is being processed for this session. */
  inflightDequeue: boolean;
  /**
   * True when the nudge cycle is armed — the session is eligible to receive
   * an mtime kick. Flipped to false when a kick fires; re-armed on dequeue.
   */
  nudgeArmed: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const _state = new Map<number, ActivityFileState>();

let _activityDirReady = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensureActivityDir(): Promise<void> {
  if (_activityDirReady) return;
  await mkdir(ACTIVITY_DIR, { recursive: true });
  _activityDirReady = true;
}

/** Validate an agent-supplied absolute path. Returns an error string or null. */
export function validateFilePath(filePath: string): string | null {
  if (!filePath || typeof filePath !== "string") {
    return "file_path must be a non-empty string";
  }
  if (filePath.includes("\0")) {
    return "file_path must not contain null bytes";
  }
  if (filePath.split(/[/\\]/).includes("..")) {
    return "file_path must not contain path traversal (..)";
  }
  if (!isAbsolute(filePath)) {
    return "file_path must be an absolute path";
  }
  return null;
}

/** Append a single newline to the file. Logs a warning if the file is missing. */
async function appendNewline(filePath: string): Promise<void> {
  try {
    await appendFile(filePath, "\n", "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      dlog("tool", `activity/file: touch skipped — file not found: ${filePath}`);
    } else {
      dlog("tool", `activity/file: touch failed for ${filePath}`, { err: String(err) });
    }
  }
}

/** Perform the actual touch and record the timestamp. */
function doTouch(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;
  entry.lastTouchAt = Date.now();
  void appendNewline(entry.filePath);
}

/**
 * Centralised poke gate. Returns true if the activity file should be touched now.
 *
 * Universal pre-condition: hasPendingUserContent(sid) must be true.
 * forceReset=true: bypasses the poke-debounce (Stop-hook path — the transition itself
 *   resets the debounce, so even a recent poke must not block a stop-triggered poke).
 * forceReset=false: applies the poke-debounce. lastTouchAt=null → first poke is free.
 */
function shouldPoke(sid: number, opts: { forceReset: boolean }): boolean {
  const entry = _state.get(sid);
  if (!entry) return false;
  if (!hasPendingUserContent(sid)) return false;
  if (opts.forceReset) return true;
  if (entry.lastTouchAt === null) return true;
  const debounceMs = Math.max(DEBOUNCE_FLOOR_MS, getKickDebounceMs(sid));
  return (Date.now() - entry.lastTouchAt) >= debounceMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Set (or replace) the activity file registration for a session. */
export function setActivityFile(sid: number, state: ActivityFileState): void {
  _state.set(sid, state);
}

/** Get the activity file state for a session (undefined if not registered). */
export function getActivityFile(sid: number): ActivityFileState | undefined {
  return _state.get(sid);
}

/** Return true if the session has an active activity file registration. */
export function isActivityFileActive(sid: number): boolean {
  return _state.has(sid);
}

/**
 * Clear the activity file registration for a session.
 * If tmcpOwned, attempt to delete the file (best-effort, no throw).
 */
export async function clearActivityFile(sid: number): Promise<void> {
  const entry = _state.get(sid);
  if (!entry) return;

  // Cancel any pending debounce timer
  if (entry.debounceTimer !== null) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }

  _state.delete(sid);

  if (entry.tmcpOwned) {
    try {
      await unlink(entry.filePath);
    } catch {
      // best-effort — file may already be gone
    }
  }
}

/**
 * Atomically replace the activity file registration for a session.
 *
 * Unlike the clear-then-set pattern (`clearActivityFile` + `setActivityFile`),
 * this function updates `_state` with the new entry BEFORE doing any async
 * cleanup of the old registration. This eliminates the window between the
 * delete and the re-set where an inbound message could call `touchActivityFile`
 * and find no entry — causing the touch (and `lastTouchAt` update) to be
 * silently dropped.
 *
 * After setting the new entry, it cancels the old debounce timer (if any) and
 * asynchronously deletes the old TMCP-owned file (if applicable).
 */
export async function replaceActivityFile(
  sid: number,
  newState: ActivityFileState,
): Promise<void> {
  const oldEntry = _state.get(sid);

  // Carry over runtime suppression state from the old entry so that a file
  // swap does not reset the nudge cycle or expose a spurious "silent since
  // epoch 0" window that would cause an immediate kick.
  if (oldEntry) {
    newState.lastActivityAt = oldEntry.lastActivityAt;
    newState.inflightDequeue = oldEntry.inflightDequeue;
    newState.nudgeArmed = oldEntry.nudgeArmed;
  }

  // Write new entry first — touch logic reads this immediately.
  _state.set(sid, newState);

  if (!oldEntry) return;

  // Cancel any pending debounce timer on the old entry.
  if (oldEntry.debounceTimer !== null) {
    clearTimeout(oldEntry.debounceTimer);
    oldEntry.debounceTimer = null;
  }

  // Delete old TMCP-owned file (best-effort, after new path is registered).
  // Guard: skip unlink if the new registration reuses the same path — we would
  // otherwise delete the file we just registered.
  if (oldEntry.tmcpOwned && oldEntry.filePath !== newState.filePath) {
    try {
      await unlink(oldEntry.filePath);
    } catch {
      // best-effort — file may already be gone
    }
  }
}

/**
 * Notify the activity file system that the agent made a tool call.
 * Resets the kick suppression window (lastActivityAt). Does NOT cancel a
 * pending kick timer — that timer was scheduled because an inbound message
 * arrived and must be allowed to fire.
 * Called from dispatchBehaviorTracking (server.ts) for every completed tool call.
 */
export function recordActivityTouch(sid: number): void {
  const entry = _state.get(sid);
  if (entry) {
    entry.lastActivityAt = Date.now();
    // Intentionally NOT cancelling entry.debounceTimer here.
    // A pending kick timer was scheduled because an inbound message arrived while
    // the agent was within the debounce window. Cancelling it here (on every tool
    // call) means kicks never fire for active agents — that is the bug this fixes.
    // The timer's re-evaluation in touchActivityFile handles all gating correctly.
  }
}

/**
 * Set the in-flight dequeue flag for a session.
 *
 * Call with active=true when a dequeue call begins processing.
 * Call with active=false when dequeue returns (any path — use finally block).
 *
 * On dequeue completion (active=false):
 * - Re-arms the nudge cycle (nudgeArmed = true)
 * - Updates lastActivityAt
 * - Clears any pending kick timer (fresh start)
 */
export function setDequeueActive(sid: number, active: boolean): void {
  const entry = _state.get(sid);
  if (!entry) return;
  entry.inflightDequeue = active;
  if (!active) {
    // Dequeue completed — re-arm the nudge cycle and reset poke-debounce
    entry.nudgeArmed = true;
    entry.lastActivityAt = Date.now();
    entry.lastTouchAt = null; // AC2: poke-debounce reset — next poke after dequeue is free
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
  }
}

/**
 * Called after every inbound message is enqueued to a session.
 *
 * Implements the idle-kick state machine:
 *   ARMED + (not in-flight dequeue) + (silent >= kickDebounce) → nudge, disarm
 *   ARMED + (not in-flight dequeue) + (silent < kickDebounce) → schedule timer
 *   NUDGE_FIRED → no further nudges until dequeue re-arms (setDequeueActive)
 *   Any tool call → recordActivityTouch resets window + clears timer
 */
export function touchActivityFile(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;

  // One-nudge-per-cycle: only fire if armed
  if (!entry.nudgeArmed) return;

  // Never kick while agent is actively dequeuing (they'll get the event on return)
  if (entry.inflightDequeue) return;

  const now = Date.now();
  const debounceMs = Math.max(DEBOUNCE_FLOOR_MS, getKickDebounceMs(sid));
  const timeSinceActivity = now - entry.lastActivityAt;

  if (timeSinceActivity < debounceMs) {
    // Still in suppression window — schedule a single timer for when window expires.
    // Don't reschedule if a timer is already pending (avoid timer storm on message bursts).
    if (entry.debounceTimer === null) {
      const delay = debounceMs - timeSinceActivity;
      // Capture identity of the entry that scheduled this timer.
      // If replaceActivityFile swaps the entry before the callback fires, bail out.
      const schedulingEntry = entry;
      entry.debounceTimer = setTimeout(() => {
        // Generation check: if _state no longer holds the same entry object,
        // this timer was orphaned by a file replacement — do not proceed.
        if (_state.get(sid) !== schedulingEntry) return;
        schedulingEntry.debounceTimer = null;
        // Re-evaluate on timer fire — conditions may have changed
        touchActivityFile(sid);
      }, delay);
    }
    return;
  }

  // Agent has been silent for >= debounce window — transition to inactive
  entry.nudgeArmed = false;
  if (entry.debounceTimer !== null) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }
  // Open-gate kick: only poke if queue-gated AND poke-debounce allows.
  if (!shouldPoke(sid, { forceReset: false })) {
    // No poke this cycle — re-arm so the next inbound can check again.
    entry.nudgeArmed = true;
    // If the queue was empty (not a debounce-skip), reset the poke-debounce window
    // so the first message that arrives after this timer-fire is free to poke.
    if (!hasPendingUserContent(sid)) {
      entry.lastTouchAt = null; // AC2: trailing-timer empty-queue reset point
    }
    return;
  }
  doTouch(sid);
}

/**
 * Handle the "stopped" HTTP event for a session.
 *
 * When an agent signals it has stopped:
 *  1. Cancel any pending debounce timer (eliminates stale scheduled kick)
 *  2. Re-arm the nudge cycle (nudgeArmed = true) so the next inbound fires promptly
 *  3. Issue an immediate doTouch so the file-watcher fires before the next session starts
 *
 * Returns { noOp: true } if no activity file is registered for the session.
 *
 * Agent-side wiring: TBD — likely a Stop hook analogous to PreCompact.
 */
export function handleSessionStopped(sid: number): { noOp: boolean } {
  const entry = _state.get(sid);
  if (!entry) return { noOp: true };

  if (entry.debounceTimer !== null) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }
  // Transition to inactive: reset activity clock and poke-debounce, re-arm nudge.
  entry.lastActivityAt = 0;
  entry.nudgeArmed = true;
  entry.lastTouchAt = null; // AC2: Stop is a reset point — next poke after stop is free
  // Stop-hook exception: forceReset=true bypasses poke-debounce (AC1/AC6-3).
  if (!shouldPoke(sid, { forceReset: true })) return { noOp: false };
  doTouch(sid);
  return { noOp: false };
}

/**
 * Create a TMCP-owned activity file in data/activity/.
 * Returns the absolute path of the created file.
 */
export async function createTmcpOwnedFile(): Promise<string> {
  await ensureActivityDir();
  const name = randomBytes(16).toString("hex");
  const filePath = resolve(ACTIVITY_DIR, name);
  // Create empty file with restricted permissions (owner-read/write only)
  const fh = await open(filePath, "a", 0o600);
  await fh.close();
  return filePath;
}

/** Reset all state. For tests only. */
export function resetActivityFileStateForTest(): void {
  for (const entry of _state.values()) {
    if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
  }
  _state.clear();
  _activityDirReady = false;
}
