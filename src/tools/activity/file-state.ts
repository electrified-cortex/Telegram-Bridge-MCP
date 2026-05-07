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
 * State machine (nudge cycle):
 *   Armed (nudgeArmed=true) → message arrives → kick fires (disarms) or is
 *   deferred by the debounce window (schedules trailing timer). Dequeue
 *   completion re-arms the cycle. Any tool call cancels the pending timer and
 *   resets the activity timestamp, extending the suppression window.
 *
 * Debounce window (kickDebounceMs, per-session via profile/kick-debounce):
 *   Suppresses repeated kicks if the agent called a tool within the window.
 *   On window expiry: one trailing touch fires and disarms.
 *
 * Inflight dequeue suppression:
 *   Kicks are skipped while a dequeue call is being processed — the agent
 *   will receive the event directly on dequeue return.
 */

import { appendFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { getKickDebounceMs } from "../../session-manager.js";
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

  // Write new entry first — touch logic reads this immediately.
  _state.set(sid, newState);

  if (!oldEntry) return;

  // Cancel any pending debounce timer on the old entry.
  if (oldEntry.debounceTimer !== null) {
    clearTimeout(oldEntry.debounceTimer);
    oldEntry.debounceTimer = null;
  }

  // Delete old TMCP-owned file (best-effort, after new path is registered).
  if (oldEntry.tmcpOwned) {
    try {
      await unlink(oldEntry.filePath);
    } catch {
      // best-effort — file may already be gone
    }
  }
}

/**
 * Notify the activity file system that the agent made a tool call.
 * Resets the kick suppression window and cancels any pending kick timer.
 * Called from dispatchBehaviorTracking (server.ts) for every completed tool call.
 */
export function recordActivityTouch(sid: number): void {
  const entry = _state.get(sid);
  if (entry) {
    entry.lastActivityAt = Date.now();
    // Cancel any pending kick timer — agent is active, no nudge needed
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
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
    // Dequeue completed — re-arm the nudge cycle
    entry.nudgeArmed = true;
    entry.lastActivityAt = Date.now();
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
      entry.debounceTimer = setTimeout(() => {
        const current = _state.get(sid);
        if (!current) return;
        current.debounceTimer = null;
        // Re-evaluate on timer fire — conditions may have changed
        touchActivityFile(sid);
      }, delay);
    }
    return;
  }

  // Agent has been silent for >= debounce window — fire the kick
  entry.nudgeArmed = false;
  if (entry.debounceTimer !== null) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }
  doTouch(sid);
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
