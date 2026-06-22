/**
 * Per-session monitor notify gate (file-touch + SSE).
 *
 * Holds ONE gate state machine per session that has ANY monitor — an activity
 * file, an SSE/listen stream, or both. The gate (debounce / 5-min
 * re-kick) is monitor-agnostic; the file touch is a side-effect that runs only
 * when a file is registered (`filePath !== null`), and the SSE kick is delivered
 * by the caller (notifySession) / the injected `_sseNotifyCallback`. This is the
 * "monitor = file OR listen; behavior MUST be the same" contract: a gate entry
 * is created when EITHER monitor appears and torn down when the last one leaves.
 *
 * GOTCHA — shared gate when a session runs BOTH channels at once:
 *   File and SSE share ONE debounce / re-notify timer (deliberately simplest;
 *   a session using both at the same time is a near-zero case). Consequence:
 *   the channels are NOT fully isolated when both are active. Most notably, a
 *   file-touch FAILURE rolls back the shared `notifyDebounceUntil` (see
 *   doTouchWithRollback), which also clears the SSE channel's debounce, so the
 *   next event can re-kick SSE earlier than its own window would allow. Each
 *   channel still works standalone; only the both-active overlap is coupled. If
 *   simultaneous use ever becomes real, split this into per-channel gates.
 *
 * Tracks whether a session has opted into the file-touch feature.
 * On inbound messages, TMCP appends "\n" to the registered file so
 * file-watchers (tail -f, Monitor) can wake the agent.
 *
 * Ownership:
 *   tmcpOwned = true  → TMCP created the file; deletes on clear/close.
 *   tmcpOwned = false → agent supplied path; TMCP never touches lifecycle.
 *
 * Notify gate (post-notify debounce):
 *   notifyIfAllowed() is the sole entry point for notifying. It:
 *     1. Classifies the event by source + inflightAtEnqueue.
 *     2. Suppresses if dequeue is in-flight (agent reads inline).
 *     3. Suppresses if the notify debounce is active (notifyDebounceUntil > now).
 *     4. If suppressed, sets notifyPendingBecauseDebounce for re-evaluation.
 *     5. Otherwise: touches the activity file, sets debounce for NOTIFY_DEBOUNCE_MS.
 *   On touch failure, debounce is rolled back and a bounded retry is scheduled.
 *
 * Debounce release:
 *   releaseNotifyDebounce() is called from content-returning dequeue exits.
 *   If a notification was suppressed during debounce AND the queue still has pending
 *   content, a re-evaluation notify fires immediately after the debounce clears.
 *   Timeout-only dequeue exits do NOT call releaseNotifyDebounce.
 *
 * Stale debounce:
 *   If the debounce expires (notifyDebounceUntil elapsed) before the agent dequeues,
 *   the next inbound fires a fresh notify. Wedged agents get at most one notify
 *   per NOTIFY_DEBOUNCE_MS.
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
 *   handleSessionStopped — clears debounce, notifies if queue has pending.
 *   resetNotifyGateState   — clears debounce state only (reconnect path).
 *   clearActivityFile    — cancels retry handle.
 *   replaceActivityFile  — cancels retry handle of old entry, carries gate state.
 */

import { appendFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { getNotifyDebounceMs } from "../../session-manager.js";
import { hasPendingUserContent } from "../../session-queue.js";
import { dlog } from "../../debug-log.js";

let _sseNotifyCallback: ((sid: number) => void) | null = null;

export function initSseNotifyCallback(fn: (sid: number) => void): void {
  _sseNotifyCallback = fn;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
/** data/activity/ lives at repo_root/data/activity/ */
const ACTIVITY_DIR = resolve(__dirname, "../../../", "data", "activity");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default post-notify debounce window (ms). */
export const NOTIFY_DEBOUNCE_MS = 300_000;

/** Minimum allowed debounce window (ms). */
export const NOTIFY_DEBOUNCE_MIN_MS = 1_000;

/** Maximum allowed debounce window (ms). */
export const NOTIFY_DEBOUNCE_MAX_MS = 3_600_000;

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
  /** Absolute path to the registered file; null when this is an SSE-only gate. */
  filePath: string | null;
  /** True if TMCP created and owns this file. */
  tmcpOwned: boolean;
  /** True while an SSE/listen monitor is connected for this session. */
  sseConnected?: boolean;
  /** True while a dequeue call is being processed for this session. */
  inflightDequeue: boolean;
  /** UTC ms when debounce expires; null = not debouncing. */
  notifyDebounceUntil: number | null;
  /** True when a notifiable inbound was suppressed during debounce. */
  notifyPendingBecauseDebounce: boolean;
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

/**
 * Sessions with a pending unexpected-subscription-close notification.
 * Consumed once on the agent's next dequeue (AC2, AC3).
 */
const _unexpectedClosePending = new Set<number>();

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

// ---------------------------------------------------------------------------
// Unexpected subscription close tracking (AC1-AC5 of task 10-3029)
// ---------------------------------------------------------------------------

/**
 * Record that the subscription for this session closed unexpectedly —
 * i.e. without the agent calling activity/listen cancel, activity/file/delete,
 * or session/close. The next dequeue call injects a
 * SUBSCRIPTION_CLOSED_UNEXPECTEDLY service message (consumed exactly once).
 *
 * Idempotent: calling multiple times for the same sid before a consume has
 * no extra effect — the message fires once per consume call.
 */
export function recordUnexpectedSubscriptionClose(sid: number): void {
  _unexpectedClosePending.add(sid);
}

/**
 * Consume the pending unexpected-close notification for a session.
 *
 * Returns true exactly once per subscription-loss event. All subsequent
 * calls return false until another unexpected close is recorded. Called by
 * runDrainLoop at dequeue time (AC2, AC3).
 */
export function consumeUnexpectedSubscriptionClose(sid: number): boolean {
  if (!_unexpectedClosePending.has(sid)) return false;
  _unexpectedClosePending.delete(sid);
  return true;
}

/**
 * Remove any pending unexpected-close notification for a session.
 * Called on session teardown to avoid orphaned Set entries.
 */
export function clearUnexpectedCloseForSession(sid: number): void {
  _unexpectedClosePending.delete(sid);
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
 * Touch the activity file and roll back the debounce if the touch fails.
 * The lockedEntry parameter is a generation guard — if _state no longer holds
 * this exact entry object, the touch is abandoned (file was replaced).
 */
async function doTouchWithRollback(sid: number, lockedEntry: ActivityFileState): Promise<void> {
  // Pre-await generation check
  if (_state.get(sid) !== lockedEntry) {
    lockedEntry.touchInFlight = false;
    return;
  }

  // SSE-only gate (no file) — nothing to touch.
  const filePath = lockedEntry.filePath;
  if (filePath === null) {
    lockedEntry.touchInFlight = false;
    return;
  }

  const ok = await appendNewline(filePath);

  // Post-await generation check (entry may have been replaced during the await)
  const recheck = _state.get(sid);
  if (!recheck || recheck !== lockedEntry) {
    lockedEntry.touchInFlight = false;
    return;
  }

  recheck.touchInFlight = false;

  if (!ok) {
    // Touch failed — roll back debounce so next inbound retries.
    // GOTCHA: when an SSE stream is ALSO attached to this session, this rollback
    // clears the debounce that channel shares, briefly un-debouncing SSE. Benign
    // (an extra kick is harmless) and near-zero in practice — see module header.
    recheck.notifyDebounceUntil = null;
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
    // Activity-file subscription is effectively dead — agent's monitor can no longer
    // receive wake notifications. Record as unexpected close (AC1, AC5).
    recordUnexpectedSubscriptionClose(sid);
    return;
  }

  entry.pendingRetryHandle = setTimeout(() => {
    void (async () => {
      entry.pendingRetryHandle = null;

      if (_state.get(sid) !== entry) return;
      const filePath = entry.filePath;
      if (filePath === null) return; // SSE-only — no file retry
      if (!hasPendingUserContent(sid)) return;

      entry.touchInFlight = true;
      const ok = await appendNewline(filePath);

      const recheck = _state.get(sid);
      if (!recheck || recheck !== entry) {
        entry.touchInFlight = false;
        return;
      }

      recheck.touchInFlight = false;

      if (ok) {
        recheck.notifyDebounceUntil = Date.now() + getNotifyDebounceMs(sid);
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
 * Fire a re-evaluation notify after debounce clears when a notifiable event was suppressed.
 * Direct touch path — does not re-enter notifyIfAllowed (no classification, never declines).
 */
function fireRevaluationNotify(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;

  if (entry.touchInFlight) {
    entry.notifyPendingBecauseDebounce = true;
    return;
  }

  entry.notifyDebounceUntil = Date.now() + getNotifyDebounceMs(sid);
  entry.notifyPendingBecauseDebounce = false;
  if (entry.filePath !== null) {
    entry.touchInFlight = true;
    void doTouchWithRollback(sid, entry);
  }
  _sseNotifyCallback?.(sid);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Set (or replace) the activity file registration for a session. */
export function setActivityFile(sid: number, state: ActivityFileState): void {
  _state.set(sid, state);
}

/**
 * Get the activity FILE registration for a session.
 *
 * Returns the entry only when a file is actually registered (`filePath !==
 * null`). A session with only an SSE monitor has a gate entry in `_state` but no
 * file; this returns `undefined` for it, so the file-oriented tools
 * (create/edit/get/delete/touch) and liveness checks see "no file registered"
 * exactly as before. Gate-internal code reads `_state` directly and is
 * unaffected by this filter. The return type narrows `filePath` to `string` so
 * callers need no null handling.
 */
export function getActivityFile(
  sid: number,
): (ActivityFileState & { filePath: string }) | undefined {
  const entry = _state.get(sid);
  if (!entry || entry.filePath === null) return undefined;
  return entry as ActivityFileState & { filePath: string };
}

/** Return true if the session has an active activity FILE registration. */
export function isActivityFileActive(sid: number): boolean {
  return _state.get(sid)?.filePath != null;
}

/** Return true if the session currently has an active SSE (activity/listen) subscription. */
export function isSseMonitorActive(sid: number): boolean {
  return _state.get(sid)?.sseConnected === true;
}

/**
 * Register that an SSE (activity/listen) monitor connected for this session.
 *
 * The notify gate (debounce / 5-min re-kick) lives in `_state` and was
 * historically created only when an activity FILE was registered. An SSE-only
 * agent has no file, so without this it would have no gate entry and every kick
 * would be suppressed by notifyIfAllowed's `!entry` guard. Creating a fileless
 * gate entry on connect brings the SSE path under the exact same gate as the
 * file path — one kick, debounced, re-kicked at 5 min.
 *
 * Idempotent: if a gate entry already exists (file monitor, or a prior SSE
 * connection), it just marks SSE present without disturbing the debounce.
 */
export function registerSseMonitor(sid: number): void {
  // Clear any pending unexpected-close notification — the monitor is re-arming
  // (either first connect or reconnect). No need to alert the agent since they
  // already have a live subscription again.
  _unexpectedClosePending.delete(sid);

  const entry = _state.get(sid);
  if (entry) {
    entry.sseConnected = true;
    return;
  }
  _state.set(sid, {
    filePath: null,
    tmcpOwned: false,
    sseConnected: true,
    inflightDequeue: false,
    notifyDebounceUntil: null,
    notifyPendingBecauseDebounce: false,
    touchInFlight: false,
    pendingRetryHandle: null,
    pendingReNotifyHandle: null,
  });
}

/**
 * Unregister the SSE monitor for this session (connection closed/cancelled).
 *
 * Clears the SSE flag. If no activity file remains, the session has no monitor
 * left, so the gate entry and its pending timers are torn down. Idempotent and
 * safe when no entry exists.
 */
/**
 * Unregister the SSE monitor for this session (connection closed/cancelled).
 *
 * @param expected Pass `true` when the agent initiated the teardown
 *   (activity/listen cancel → cancelSseConnection). Pass `false` (default) for
 *   organic closes — req 'close' event or keepalive failure — which trigger a
 *   SUBSCRIPTION_CLOSED_UNEXPECTEDLY service message on the agent's next dequeue.
 */
export function unregisterSseMonitor(sid: number, expected: boolean = false): void {
  const entry = _state.get(sid);
  if (!entry) return;

  // Record unexpected close BEFORE clearing sseConnected so the flag check is accurate.
  if (!expected && entry.sseConnected) {
    recordUnexpectedSubscriptionClose(sid);
  }

  entry.sseConnected = false;
  if (entry.filePath === null) {
    if (entry.pendingRetryHandle !== null) {
      clearTimeout(entry.pendingRetryHandle);
      entry.pendingRetryHandle = null;
    }
    if (entry.pendingReNotifyHandle !== null) {
      clearTimeout(entry.pendingReNotifyHandle);
      entry.pendingReNotifyHandle = null;
    }
    _state.delete(sid);
  }
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
): boolean {
  const entry = _state.get(sid);
  if (!entry) return false;

  // 1. Source classification
  if (!classify(source, inflightAtEnqueue)) return false;

  // 2. In-flight suppression: agent is blocked in dequeue, event delivered inline
  if (entry.inflightDequeue) return false;

  // 3. Touch-in-flight: another notify is already executing
  if (entry.touchInFlight) {
    entry.notifyPendingBecauseDebounce = true;
    return false;
  }

  // 4. Debounce check
  const now = Date.now();
  if (entry.notifyDebounceUntil !== null && entry.notifyDebounceUntil > now) {
    entry.notifyPendingBecauseDebounce = true;
    return false;
  }

  // 5. Notify — arm the shared gate (debounce + 5-min re-notify timer) for every
  //    monitor. The file touch runs only when a file is registered; for an
  //    SSE-only gate the kick is delivered by the caller (notifySession) on the
  //    `true` return. Both monitors are debounced by the same window.
  // Cancel any existing re-notify timer before registering a new one
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
  }
  const debounceMs = getNotifyDebounceMs(sid);
  entry.notifyDebounceUntil = now + debounceMs;
  entry.pendingReNotifyHandle = setTimeout(() => {
    entry.pendingReNotifyHandle = null;
    // TODO §5-b: include reminder types once §5-b lands
    if (hasPendingUserContent(sid)) {
      fireRevaluationNotify(sid);
    }
  }, debounceMs);
  entry.notifyPendingBecauseDebounce = false;
  if (entry.filePath !== null) {
    // Synchronous reservation before the async touch (atomic in single-thread).
    entry.touchInFlight = true;
    void doTouchWithRollback(sid, entry);
  }
  return true;
}

/**
 * Release the notify debounce after any dequeue exit (content-returning or timeout).
 * If a notifiable event was suppressed during debounce AND the queue still has
 * pending content, fires one re-evaluation notify immediately.
 */
export function releaseNotifyDebounce(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;
  if (entry.notifyDebounceUntil === null && !entry.notifyPendingBecauseDebounce) return;

  const pending = entry.notifyPendingBecauseDebounce;
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
    entry.pendingReNotifyHandle = null;
  }
  entry.notifyDebounceUntil = null;
  entry.notifyPendingBecauseDebounce = false;

  if (pending && hasPendingUserContent(sid)) {
    fireRevaluationNotify(sid);
  }
}

/**
 * Set the in-flight dequeue flag for a session.
 * Call active=true when dequeue starts; active=false when it returns (any path).
 * Debounce release is handled separately — call releaseNotifyDebounce() from
 * content-returning exits only.
 */
export function setDequeueActive(sid: number, active: boolean): void {
  const entry = _state.get(sid);
  if (!entry) return;
  entry.inflightDequeue = active;
}

/**
 * Reset only the notify gate state for a session (reconnect path).
 * Clears debounce and pending flags without touching the file path or notifying.
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

  entry.notifyDebounceUntil = null;
  entry.notifyPendingBecauseDebounce = false;
  entry.touchInFlight = false;
}

/**
 * Notify the activity file system that the agent made a tool call.
 * No-op in the debounce model — kept for call-site compatibility with server.ts.
 */
export function recordActivityTouch(_sid: number): void {
  // No-op: the debounce model does not track per-tool-call activity.
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
  entry.notifyDebounceUntil = null;
  entry.notifyPendingBecauseDebounce = false;
  entry.touchInFlight = false;
  entry.inflightDequeue = false;

  // Notify if queue has pending content so the new agent gets a wake-up signal.
  // Parity: touch the file when one is registered AND kick the SSE stream when
  // one is connected — both monitors wake identically.
  if (hasPendingUserContent(sid)) {
    entry.notifyDebounceUntil = Date.now() + getNotifyDebounceMs(sid);
    if (entry.filePath !== null) {
      entry.touchInFlight = true;
      void doTouchWithRollback(sid, entry);
    }
    _sseNotifyCallback?.(sid);
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

  // Remove any pending unexpected-close notification — session is tearing down
  // and no future dequeue will be able to deliver it anyway.
  _unexpectedClosePending.delete(sid);

  // The file-touch retry targets the file path — meaningless once it is gone.
  if (entry.pendingRetryHandle !== null) {
    clearTimeout(entry.pendingRetryHandle);
    entry.pendingRetryHandle = null;
  }

  const filePath = entry.filePath;
  const tmcpOwned = entry.tmcpOwned;

  if (entry.sseConnected) {
    // An SSE monitor is still active — keep the shared gate entry alive (its
    // debounce + re-notify timer still govern the SSE stream); drop only the
    // file registration.
    entry.filePath = null;
    entry.tmcpOwned = false;
    entry.touchInFlight = false;
  } else {
    // No monitor left — tear down the gate entry and its re-notify timer.
    if (entry.pendingReNotifyHandle !== null) {
      clearTimeout(entry.pendingReNotifyHandle);
      entry.pendingReNotifyHandle = null;
    }
    _state.delete(sid);
  }

  if (tmcpOwned && filePath !== null) {
    try {
      await unlink(filePath);
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
  // Clear any pending unexpected-close notification — agent is re-registering
  // a file, so the subscription is being restored.
  _unexpectedClosePending.delete(sid);

  const oldEntry = _state.get(sid);

  if (oldEntry) {
    // Carry over in-flight gate state so a file swap does not reset an active debounce
    newState.inflightDequeue = oldEntry.inflightDequeue;
    newState.notifyDebounceUntil = oldEntry.notifyDebounceUntil;
    newState.notifyPendingBecauseDebounce = oldEntry.notifyPendingBecauseDebounce;
    newState.touchInFlight = oldEntry.touchInFlight;
    // Carry over the SSE monitor flag — registering/swapping a file must not
    // drop an already-connected SSE stream's gate membership.
    newState.sseConnected = oldEntry.sseConnected;
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
  if (oldEntry.tmcpOwned && oldEntry.filePath !== null && oldEntry.filePath !== newState.filePath) {
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
  _unexpectedClosePending.clear();
  _activityDirReady = false;
}
