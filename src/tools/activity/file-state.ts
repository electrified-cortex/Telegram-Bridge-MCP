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

import { appendFile, writeFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { getNotifyDebounceMs } from "../../session-manager.js";
import { hasPendingUserContent, hasPendingReminderContent } from "../../session-queue.js";
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
  /**
   * The source that armed the current debounce window, or null when the gate is
   * idle. Tracked so high-priority sources (operator, reminder, approval) can
   * bypass a debounce armed by a lower-priority source (service), preventing
   * child-session service messages from silencing operator notifications for the
   * parent session (task 10-3067, AC1).
   */
  debounceArmedBySource?: NotifySource | null;
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
// First-notify timestamp tracking (AC3/AC4 of offline detection, task 10-0011)
// ---------------------------------------------------------------------------

/**
 * sid → timestamp (Date.now()) of the first SSE notification fired for the
 * current pending message batch.  Reset by releaseNotifyDebounce() when the
 * batch is fully consumed (no pending content remains after the dequeue).
 * Preserved on timeout exits and synthetic returns (animation_stale_warning)
 * so the 10-minute grace window keeps counting from the original notification.
 * Also cleaned up when the last monitor for a session is torn down.
 */
const _firstNotifyTs = new Map<number, number>();

/**
 * Record the first SSE notification timestamp for a session's current batch.
 * Idempotent — only the very first notification for a given batch is captured;
 * subsequent notifications (re-notify timer, etc.) leave the timestamp alone.
 */
function recordFirstNotify(sid: number): void {
  if (!_firstNotifyTs.has(sid)) {
    _firstNotifyTs.set(sid, Date.now());
  }
}

/**
 * Returns the timestamp (Date.now()) of the first SSE notification sent for
 * the current pending message batch, or null if no notification has fired
 * since the last content-returning dequeue.
 *
 * Used by the health check to implement the 10-minute SSE-notification grace
 * window (AC3/AC4 of task 10-0011): "appears offline" is only raised after
 * a notification was sent AND the session still has not dequeued for
 * DEQUEUE_GAP_GRACE_MS since that notification.
 */
export function getFirstNotifyTimestamp(sid: number): number | null {
  return _firstNotifyTs.get(sid) ?? null;
}

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
    // Signal file-watch monitor before giving up — overwrite file with MONITOR_EXIT so
    // monitor.sh detects the content change and exits cleanly (re-arm needed).
    if (entry.filePath !== null) {
      void writeFile(
        entry.filePath,
        "MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm",
      ).catch(() => {});
    }
    return;
  }

  // Clear any existing retry handle before scheduling a new one to prevent timer leaks.
  if (entry.pendingRetryHandle !== null) {
    clearTimeout(entry.pendingRetryHandle);
    entry.pendingRetryHandle = null;
  }

  entry.pendingRetryHandle = setTimeout(() => {
    void (async () => {
      entry.pendingRetryHandle = null;

      if (_state.get(sid) !== entry) return;
      const filePath = entry.filePath;
      if (filePath === null) return; // SSE-only — no file retry
      if (!hasPendingUserContent(sid) && !hasPendingReminderContent(sid)) return;

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
  // Record first-notify timestamp for offline-detection grace window (AC3/AC4).
  recordFirstNotify(sid);
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
    debounceArmedBySource: null,
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
 *
 * @param expected Pass `true` when the agent initiated the teardown
 *   (activity/listen cancel → cancelSseConnection). Pass `false` (default) for
 *   organic closes — req 'close' event or keepalive failure. Callers are expected
 *   to emit `data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm`
 *   on the SSE stream BEFORE calling this function so the agent wakes immediately.
 */
export function unregisterSseMonitor(sid: number, _expected: boolean = false): void {
  const entry = _state.get(sid);
  if (!entry) return;

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
    _firstNotifyTs.delete(sid); // no monitor left — clean up first-notify tracking
  }
}

/** Return true if the session currently has an active SSE (activity/listen) subscription. */
export function isSseMonitorActive(sid: number): boolean {
  return _state.get(sid)?.sseConnected === true;
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
  //
  // High-priority sources (operator, reminder, approval) bypass a debounce that
  // was armed by a "service" message. This prevents child-session service messages
  // (e.g. CHILD_FIRST_DEQUEUE_CONFIRMED) from silencing operator notifications for
  // the parent session while the child is active (task 10-3067, AC1).
  //
  // A service-message-armed debounce is a burst-protection window for server-
  // generated lifecycle events; it must NOT delay urgent operator messages.
  // Debounces armed by operator or other high-priority sources are still enforced
  // (preserving the existing burst-dedup behaviour for rapid operator messages).
  const now = Date.now();
  if (entry.notifyDebounceUntil !== null && entry.notifyDebounceUntil > now) {
    const armedByService = (entry.debounceArmedBySource ?? null) === "service";
    const isHighPriority = source === "operator" || source === "reminder" ||
      source === "approval-self" || source === "approval-governor";
    if (!(armedByService && isHighPriority)) {
      entry.notifyPendingBecauseDebounce = true;
      return false;
    }
    // Fall through: high-priority source overrides a service-message debounce.
  }

  // 5. Notify — arm the shared gate (debounce + 5-min re-notify timer) for every
  //    monitor. The file touch runs only when a file is registered; for an
  //    SSE-only gate the kick is delivered by the caller (notifySession) on the
  //    `true` return. Both monitors are debounced by the same window.
  // Cancel any existing re-notify timer before registering a new one
  if (entry.pendingReNotifyHandle !== null) {
    clearTimeout(entry.pendingReNotifyHandle);
  }
  // Two-tier debounce: shorter when dequeue is active (agent is reading),
  // longer when idle (agent is parked).
  const debounceMs = inflightAtEnqueue ? 60_000 : 300_000;
  entry.notifyDebounceUntil = now + debounceMs;
  entry.debounceArmedBySource = source;
  entry.pendingReNotifyHandle = setTimeout(() => {
    entry.pendingReNotifyHandle = null;
    entry.notifyDebounceUntil = null; // clear gate so next message fires immediately
    if (hasPendingUserContent(sid) || hasPendingReminderContent(sid)) {
      fireRevaluationNotify(sid);
    }
  }, debounceMs);
  entry.notifyPendingBecauseDebounce = false;
  if (entry.filePath !== null) {
    // Synchronous reservation before the async touch (atomic in single-thread).
    entry.touchInFlight = true;
    void doTouchWithRollback(sid, entry);
  }
  // Record the first SSE notification timestamp for offline-detection grace window (AC3/AC4).
  recordFirstNotify(sid);
  return true;
}

/**
 * Release the notify debounce after any dequeue exit (content-returning or timeout).
 * If a notifiable event was suppressed during debounce AND the queue still has
 * pending content, fires one re-evaluation notify immediately.
 */
export function releaseNotifyDebounce(sid: number, contentReturned = true): void {
  // Reset the first-notify clock only when content was actually returned AND
  // the session has no more pending content after the dequeue.  On timeout
  // exits (contentReturned = false) the user's messages are still queued, so
  // the clock must keep running from the original first SSE notification (AC4,
  // task 10-0011).  hasPendingUserContent/hasPendingReminderContent are also
  // called later in this function — the circular dep is handled via ESM lazy
  // binding, same as the existing call below.
  if (contentReturned && !hasPendingUserContent(sid) && !hasPendingReminderContent(sid)) {
    _firstNotifyTs.delete(sid);
  }
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
  entry.debounceArmedBySource = null;

  if (pending && (hasPendingUserContent(sid) || hasPendingReminderContent(sid))) {
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
  entry.debounceArmedBySource = null;
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
  entry.debounceArmedBySource = null;
  entry.touchInFlight = false;
  entry.inflightDequeue = false;

  // Notify if queue has pending content so the new agent gets a wake-up signal.
  // Parity: touch the file when one is registered AND kick the SSE stream when
  // one is connected — both monitors wake identically.
  if (hasPendingUserContent(sid) || hasPendingReminderContent(sid)) {
    entry.notifyDebounceUntil = Date.now() + getNotifyDebounceMs(sid);
    if (entry.filePath !== null) {
      entry.touchInFlight = true;
      void doTouchWithRollback(sid, entry);
    }
    // Record first-notify timestamp for offline-detection grace window (AC3/AC4).
    recordFirstNotify(sid);
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
    // Clean up first-notify tracking — no monitor left, entry is gone.
    _firstNotifyTs.delete(sid);
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
  const oldEntry = _state.get(sid);

  if (oldEntry) {
    // Carry over in-flight gate state so a file swap does not reset an active debounce
    newState.inflightDequeue = oldEntry.inflightDequeue;
    newState.notifyDebounceUntil = oldEntry.notifyDebounceUntil;
    newState.notifyPendingBecauseDebounce = oldEntry.notifyPendingBecauseDebounce;
    newState.debounceArmedBySource = oldEntry.debounceArmedBySource;
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
  _firstNotifyTs.clear();
  _activityDirReady = false;
}
