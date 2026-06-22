/**
 * Per-session activity file state and notify gate.
 *
 * Tracks whether a session has opted into the file-touch feature.
 * On inbound messages, TMCP appends "\n" to the registered file so
 * file-watchers (tail -f, Monitor) can wake the agent.
 *
 * Ownership:
 *   tmcpOwned = true  → TMCP created the file; deletes on clear/close.
 *   tmcpOwned = false → agent supplied path; TMCP never touches lifecycle.
 *
 * Notify gate (post-notify lockout):
 *   notifyIfAllowed() is the sole entry point for notifying. It:
 *     1. Classifies the event by source + inflightAtEnqueue.
 *     2. Suppresses if dequeue is in-flight (agent reads inline).
 *     3. Suppresses if the notify lockout is active (notifyLockedUntil > now).
 *     4. If suppressed, sets notifyPendingBecauseLocked for re-evaluation.
 *     5. Otherwise: touches the activity file, sets lockout for LOCKOUT_MS.
 *   On touch failure, lockout is rolled back and a bounded retry is scheduled.
 *
 * Lockout release:
 *   releaseNotifyLockout() is called from content-returning dequeue exits.
 *   If a notification was suppressed during lockout AND the queue still has pending
 *   content, a re-evaluation notify fires immediately after the lockout clears.
 *   Timeout-only dequeue exits do NOT call releaseNotifyLockout.
 *
 * Stale lockout:
 *   If the lockout expires (notifyLockedUntil elapsed) before the agent dequeues,
 *   the next inbound fires a fresh notify. Wedged agents get at most one notify
 *   per LOCKOUT_MS.
 *
 * Classification (A.3):
 *   source          | inflightAtEnqueue | notifies?
 *   ----------------+-------------------+----------
 *   operator        | *                 | yes
 *   reminder        | *                 | yes
 *   approval-self   | *                 | yes
 *   approval-governor| *                | yes
 *   service         | true              | no  (agent reads inline)
 *   service         | false             | yes
 *   bridge-internal | *                 | no
 *
 * Reset points:
 *   handleSessionStopped — clears lockout, notifies if queue has pending.
 *   resetNotifyGateState   — clears lockout state only (reconnect path).
 *   clearActivityFile    — cancels retry handle.
 *   replaceActivityFile  — cancels retry handle of old entry, carries gate state.
 */

import { appendFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { getNotifyLockoutMs } from "../../session-manager.js";
import { hasPendingUserContent } from "../../session-queue.js";
import { dlog } from "../../debug-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** data/activity/ lives at repo_root/data/activity/ */
const ACTIVITY_DIR = resolve(__dirname, "../../../", "data", "activity");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default post-notify lockout window (ms). */
export const LOCKOUT_DEFAULT_MS = 300_000;

/** Minimum allowed lockout window (ms). */
export const LOCKOUT_MIN_MS = 1_000;

/** Maximum allowed lockout window (ms). */
export const LOCKOUT_MAX_MS = 3_600_000;

// Kept for deprecated profile/kick-debounce migration response only.
export const NOTIFY_DEBOUNCE_DEFAULT_MS = 60_000;
export const NOTIFY_DEBOUNCE_MIN_MS = 1_000;
export const NOTIFY_DEBOUNCE_MAX_MS = 600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotifySource =
  | "operator"
  | "reminder"
  | "approval-self"
  | "approval-governor"
  | "service"
  | "bridge-internal";

export interface ActivityFileState {
  /** Absolute path to the registered file. */
  filePath: string;
  /** True if TMCP created and owns this file. */
  tmcpOwned: boolean;
  /** True while a dequeue call is being processed for this session. */
  inflightDequeue: boolean;
  /** UTC ms when lockout expires; null = not locked. */
  notifyLockedUntil: number | null;
  /** True when a notifiable inbound was suppressed during lockout. */
  notifyPendingBecauseLocked: boolean;
  /** True while appendNewline is in flight (including retries). */
  touchInFlight: boolean;
  /** setTimeout handle for the next bounded retry; null if none. */
  pendingRetryHandle: ReturnType<typeof setTimeout> | null;
  /** setTimeout handle for the one-shot 5-min active re-notify; null if none. */
  pendingReNotifyHandle: ReturnType<typeof setTimeout> | null;
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

/**
 * Append a single newline to the file.
 * Returns true on success. On ENOENT, attempts to recreate the file and retry.
 * Returns false if the touch ultimately failed (any non-ENOENT error, or recreation failed).
 */
async function appendNewline(filePath: string): Promise<boolean> {
  try {
    await appendFile(filePath, "\n", "utf-8");
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.warn(`[activity/file] file missing — recreating at registered path: ${filePath}`);
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const fh = await open(filePath, "a", 0o600);
        await fh.close();
        await appendFile(filePath, "\n", "utf-8");
        return true;
      } catch (recreateErr: unknown) {
        console.warn(`[activity/file] recreation failed for ${filePath}: ${String(recreateErr)}`);
        return false;
      }
    } else {
      dlog("tool", `activity/file: touch failed for ${filePath}`, { err: String(err) });
      return false;
    }
  }
}

/**
 * Touch the activity file and roll back the lockout if the touch fails.
 * The lockedEntry parameter is a generation guard — if _state no longer holds
 * this exact entry object, the touch is abandoned (file was replaced).
 */
async function doTouchWithRollback(sid: number, lockedEntry: ActivityFileState): Promise<void> {
  // Pre-await generation check
  if (_state.get(sid) !== lockedEntry) {
    lockedEntry.touchInFlight = false;
    return;
  }

  const ok = await appendNewline(lockedEntry.filePath);

  // Post-await generation check (entry may have been replaced during the await)
  const recheck = _state.get(sid);
  if (!recheck || recheck !== lockedEntry) {
    lockedEntry.touchInFlight = false;
    return;
  }

  recheck.touchInFlight = false;

  if (!ok) {
    // Touch failed — roll back lockout so next inbound retries
    recheck.notifyLockedUntil = null;
    scheduleRetry(sid, recheck, 0);
  }
}

/**
 * Schedule a bounded retry after touch failure.
 * Delays: attempt 0 → 1 s, attempt 1 → 5 s, attempt 2+ → give up.
 */
function scheduleRetry(sid: number, entry: ActivityFileState, attempt: number): void {
  const RETRY_DELAYS = [1_000, 5_000];

  if (attempt >= RETRY_DELAYS.length) {
    dlog("tool", `activity/file: touch retry exhausted for sid=${sid}; next inbound retries fresh`);
    return;
  }

  entry.pendingRetryHandle = setTimeout(() => {
    void (async () => {
      entry.pendingRetryHandle = null;

      if (_state.get(sid) !== entry) return;
      if (!hasPendingUserContent(sid)) return;

      entry.touchInFlight = true;
      const ok = await appendNewline(entry.filePath);

      const recheck = _state.get(sid);
      if (!recheck || recheck !== entry) {
        entry.touchInFlight = false;
        return;
      }

      recheck.touchInFlight = false;

      if (ok) {
        recheck.notifyLockedUntil = Date.now() + getNotifyLockoutMs(sid);
      } else {
        scheduleRetry(sid, recheck, attempt + 1);
      }
    })();
  }, RETRY_DELAYS[attempt]);
}

/** Classify whether a source + context warrants a notify. Pure over inputs. */
function classify(source: NotifySource, inflightAtEnqueue: boolean): boolean {
  switch (source) {
    case "bridge-internal": return false;
    case "service": return !inflightAtEnqueue;
    default: return true; // operator, reminder, approval-self, approval-governor
  }
}

/**
 * Fire a re-evaluation notify after lockout clears when a notifiable event was suppressed.
 * Direct touch path — does not re-enter notifyIfAllowed (no classification, never declines).
 */
function fireRevaluationNotify(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;

  if (entry.touchInFlight) {
    entry.notifyPendingBecauseLocked = true;
    return;
  }

  entry.touchInFlight = true;
  entry.notifyLockedUntil = Date.now() + getNotifyLockoutMs(sid);
  entry.notifyPendingBecauseLocked = false;
  void doTouchWithRollback(sid, entry);
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

/** Return true if the session currently has an in-flight dequeue. */
export function isDequeueActive(sid: number): boolean {
  return _state.get(sid)?.inflightDequeue ?? false;
}

/**
 * Gate function called after every inbound event enqueue.
 *
 * Classifies the event by source and inflightAtEnqueue, then decides
 * whether to notify the activity file now, suppress (and arm re-evaluation),
 * or skip entirely. Synchronous reservation above the await is atomic in
 * Node.js single-threaded execution — no mutex required.
 */
export function notifyIfAllowed(
  sid: number,
  source: NotifySource,
  inflightAtEnqueue: boolean,
): void {
  const entry = _state.get(sid);
  if (!entry) return;

  // 1. Source classification
  if (!classify(source, inflightAtEnqueue)) return;

  // 2. In-flight suppression: agent is blocked in dequeue, event delivered inline
  if (entry.inflightDequeue) return;

  // 3. Touch-in-flight: another notify is already executing
  if (entry.touchInFlight) {
    entry.notifyPendingBecauseLocked = true;
    return;
  }

  // 4. Lockout check
  const now = Date.now();
  if (entry.notifyLockedUntil !== null && entry.notifyLockedUntil > now) {
    entry.notifyPendingBecauseLocked = true;
    return;
  }

  // 5. Notify — synchronous reservation before async touch
  entry.touchInFlight = true;
  // Cancel any existing re-notify timer before registering a new one
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
  }
  const lockoutMs = getNotifyLockoutMs(sid);
  entry.notifyLockedUntil = now + lockoutMs;
  entry.pendingReNotifyHandle = setTimeout(() => {
    entry.pendingReNotifyHandle = null;
    // TODO §5-b: include reminder types once §5-b lands
    if (hasPendingUserContent(sid)) {
      fireRevaluationNotify(sid);
    }
  }, lockoutMs);
  entry.notifyPendingBecauseLocked = false;
  void doTouchWithRollback(sid, entry);
}

/**
 * Release the notify lockout after any dequeue exit (content-returning or timeout).
 * If a notifiable event was suppressed during lockout AND the queue still has
 * pending content, fires one re-evaluation notify immediately.
 */
export function releaseNotifyLockout(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;
  if (entry.notifyLockedUntil === null && !entry.notifyPendingBecauseLocked) return;

  const pending = entry.notifyPendingBecauseLocked;
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
    entry.pendingReNotifyHandle = null;
  }
  entry.notifyLockedUntil = null;
  entry.notifyPendingBecauseLocked = false;

  if (pending && hasPendingUserContent(sid)) {
    fireRevaluationNotify(sid);
  }
}

/**
 * Set the in-flight dequeue flag for a session.
 * Call active=true when dequeue starts; active=false when it returns (any path).
 * Lockout release is handled separately — call releaseNotifyLockout() from
 * content-returning exits only.
 */
export function setDequeueActive(sid: number, active: boolean): void {
  const entry = _state.get(sid);
  if (!entry) return;
  entry.inflightDequeue = active;
}

/**
 * Reset only the notify gate state for a session (reconnect path).
 * Clears lockout and pending flags without touching the file path or notifying.
 * The next inbound will fire a fresh notify.
 */
export function resetNotifyGateState(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;

  if (entry.pendingRetryHandle !== null) {
    clearTimeout(entry.pendingRetryHandle);
    entry.pendingRetryHandle = null;
  }

  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
    entry.pendingReNotifyHandle = null;
  }

  entry.notifyLockedUntil = null;
  entry.notifyPendingBecauseLocked = false;
  entry.touchInFlight = false;
}

/**
 * Notify the activity file system that the agent made a tool call.
 * No-op in the lockout model — kept for call-site compatibility with server.ts.
 */
export function recordActivityTouch(_sid: number): void {
  // No-op: the lockout model does not track per-tool-call activity.
}

/**
 * Handle the "stopped" event for a session.
 * Resets all notify gate state and fires a notify if the queue has pending content
 * so the arriving agent gets notified on reconnect.
 */
export function handleSessionStopped(sid: number): { noOp: boolean } {
  const entry = _state.get(sid);
  if (!entry) return { noOp: true };

  // Cancel any pending retry
  if (entry.pendingRetryHandle !== null) {
    clearTimeout(entry.pendingRetryHandle);
    entry.pendingRetryHandle = null;
  }

  // Cancel any pending re-notify timer (prevents ghost timer after restart)
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
    entry.pendingReNotifyHandle = null;
  }

  // Reset all gate state
  entry.notifyLockedUntil = null;
  entry.notifyPendingBecauseLocked = false;
  entry.touchInFlight = false;
  entry.inflightDequeue = false;

  // Notify if queue has pending content so the new agent gets a wake-up signal
  if (hasPendingUserContent(sid)) {
    entry.touchInFlight = true;
    entry.notifyLockedUntil = Date.now() + getNotifyLockoutMs(sid);
    void doTouchWithRollback(sid, entry);
  }

  return { noOp: false };
}

/**
 * Clear the activity file registration for a session.
 * If tmcpOwned, attempt to delete the file (best-effort, no throw).
 */
export async function clearActivityFile(sid: number): Promise<void> {
  const entry = _state.get(sid);
  if (!entry) return;

  if (entry.pendingRetryHandle !== null) {
    clearTimeout(entry.pendingRetryHandle);
    entry.pendingRetryHandle = null;
  }

  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
    entry.pendingReNotifyHandle = null;
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
 * Carries over in-flight gate state from the old entry.
 * Cancels the old entry's pending retry handle; does not carry it over.
 */
export async function replaceActivityFile(
  sid: number,
  newState: ActivityFileState,
): Promise<void> {
  const oldEntry = _state.get(sid);

  if (oldEntry) {
    // Carry over in-flight gate state so a file swap does not reset an active lockout
    newState.inflightDequeue = oldEntry.inflightDequeue;
    newState.notifyLockedUntil = oldEntry.notifyLockedUntil;
    newState.notifyPendingBecauseLocked = oldEntry.notifyPendingBecauseLocked;
    newState.touchInFlight = oldEntry.touchInFlight;
    // Do not carry over pendingRetryHandle — old retry targets old file path
    newState.pendingRetryHandle = null;
    // Do not carry over pendingReNotifyHandle — cancel old timer, new entry starts fresh
    newState.pendingReNotifyHandle = null;
  }

  // Write new entry first — notify logic reads this immediately
  _state.set(sid, newState);

  if (!oldEntry) return;

  // Cancel any pending retry on the old entry
  if (oldEntry.pendingRetryHandle !== null) {
    clearTimeout(oldEntry.pendingRetryHandle);
    oldEntry.pendingRetryHandle = null;
  }

  // Cancel any pending re-notify timer on the old entry
  if (oldEntry.pendingReNotifyHandle !== null) {
    clearTimeout(oldEntry.pendingReNotifyHandle);
    oldEntry.pendingReNotifyHandle = null;
  }

  // Delete old TMCP-owned file (best-effort, after new path is registered)
  if (oldEntry.tmcpOwned && oldEntry.filePath !== newState.filePath) {
    try {
      await unlink(oldEntry.filePath);
    } catch {
      // best-effort — file may already be gone
    }
  }
}

/**
 * Create a TMCP-owned activity file in data/activity/.
 * Returns the absolute path of the created file.
 */
export async function createTmcpOwnedFile(): Promise<string> {
  await ensureActivityDir();
  const name = randomBytes(16).toString("hex");
  const filePath = resolve(ACTIVITY_DIR, name);
  const fh = await open(filePath, "a", 0o600);
  await fh.close();
  return filePath;
}

/**
 * Clear ALL registered activity files (for use on full TMCP shutdown / SIGTERM).
 * Best-effort: individual failures do not block others.
 */
export async function clearAllActivityFiles(): Promise<void> {
  const sids = [..._state.keys()];
  await Promise.allSettled(sids.map((sid) => clearActivityFile(sid)));
}

/** Reset all state. For tests only. */
export function resetActivityFileStateForTest(): void {
  for (const entry of _state.values()) {
    if (entry.pendingRetryHandle !== null) clearTimeout(entry.pendingRetryHandle);
    if (entry.pendingReNotifyHandle !== null) {
      clearTimeout(entry.pendingReNotifyHandle);
      entry.pendingReNotifyHandle = null;
    }
  }
  _state.clear();
  _activityDirReady = false;
}
