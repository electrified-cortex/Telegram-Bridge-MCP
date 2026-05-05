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
 * Debounce (leading + trailing-if-suppressed):
 *   - First message → touch fires immediately (leading edge).
 *   - Subsequent messages within DEBOUNCE_WINDOW_MS → absorbed.
 *   - When window expires: if absorbedCount > 0 → one trailing touch.
 *   - After trailing (or expiry with no absorbed): next msg is a fresh leading.
 *
 * Activity-aware suppression:
 *   - If the session had any tool call within ACTIVITY_SUPPRESS_MS, skip touch.
 *     (Agent is already awake — no point kicking it.)
 *   - behavior-tracker.ts does not expose a "last tool call at" timestamp,
 *     so we maintain lastActivityAt per-entry, updated via recordActivityTouch().
 *
 * Max-interval ceiling (MAX_INTERVAL_MS):
 *   - If no touch has fired for >= MAX_INTERVAL_MS and a message arrives,
 *     force a touch regardless of debounce/activity suppression.
 */

import { appendFile, unlink, mkdir, open } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** data/activity/ lives at repo_root/data/activity/ */
const ACTIVITY_DIR = resolve(__dirname, "../../../", "data", "activity");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum debounce floor (hard constraint per spec). */
const DEBOUNCE_FLOOR_MS = 1_000;

/** Default debounce window. */
const DEBOUNCE_WINDOW_MS = 5_000;

/** Activity-aware suppression: if agent had a tool call within this window, skip touch. */
const ACTIVITY_SUPPRESS_MS = 10_000;

/** Max interval ceiling: force a touch after this many ms without one (if messages are pending). */
const MAX_INTERVAL_MS = 30_000;

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
  /** Active debounce timer handle, or null if none. */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Number of messages absorbed during the current debounce window. */
  absorbedCount: number;
  /** Timestamp (ms) of the last agent tool call (for activity suppression). */
  lastActivityAt: number;
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
  if (filePath.includes("..")) {
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
      console.warn(`[activity/file] touch skipped — file not found: ${filePath}`);
    } else {
      console.warn(`[activity/file] touch failed for ${filePath}:`, err);
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
 * Notify the activity file system that the agent made a tool call.
 * Resets the activity suppression window so we don't kick an awake agent.
 */
export function recordActivityTouch(sid: number): void {
  const entry = _state.get(sid);
  if (entry) {
    entry.lastActivityAt = Date.now();
  }
}

/**
 * Called after every inbound message is enqueued to a session.
 * Implements the debounce + activity-aware suppression + max-interval logic.
 */
export function touchActivityFile(sid: number): void {
  const entry = _state.get(sid);
  if (!entry) return;

  const now = Date.now();

  // Max-interval ceiling: if it's been too long since the last touch, force one now
  const sinceLastTouch = entry.lastTouchAt !== null ? now - entry.lastTouchAt : Infinity;
  const forceByInterval = sinceLastTouch >= MAX_INTERVAL_MS;

  // Activity suppression: skip if agent was active recently
  const agentRecentlyActive = (now - entry.lastActivityAt) < ACTIVITY_SUPPRESS_MS;

  if (agentRecentlyActive && !forceByInterval) {
    // Agent is awake; absorb this message into the debounce window if one is running
    if (entry.debounceTimer !== null) {
      entry.absorbedCount++;
    }
    return;
  }

  // If a debounce window is already running, absorb this message
  if (entry.debounceTimer !== null) {
    entry.absorbedCount++;
    return;
  }

  // Leading edge: fire immediately
  doTouch(sid);

  // Start the debounce window
  entry.absorbedCount = 0;
  entry.debounceTimer = setTimeout(() => {
    const current = _state.get(sid);
    if (!current) return;
    current.debounceTimer = null;
    // Trailing touch if any messages were absorbed during the window
    if (current.absorbedCount > 0) {
      current.absorbedCount = 0;
      doTouch(sid);
    }
  }, Math.max(DEBOUNCE_FLOOR_MS, DEBOUNCE_WINDOW_MS));
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
