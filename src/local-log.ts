/**
 * Always-on local session logging.
 *
 * Logs all session events to local files in data/logs/ with rolling filenames.
 * Log files never transit Telegram — they are local-only.
 *
 * Naming: data/logs/YYYY-MM-DDTHHMMSS.json
 *
 * Features:
 *  - Logging enabled by default on startup (opt-out via disableLogging())
 *  - roll(): finalize current file, start a new one
 *  - getLog(filename): read file content
 *  - deleteLog(filename): delete a log file
 *  - listLogs(): list archived log files
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, "..", "data", "logs");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _enabled = true;
let _currentFilename: string | null = null;
/** Buffer of events for the current log file (JSON array entries, not yet written). */
let _buffer: unknown[] = [];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/** Format a Date to YYYY-MM-DDTHHMMSS (file-safe ISO-like). */
function formatTimestamp(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function newFilename(): string {
  return `${formatTimestamp(new Date())}.json`;
}

function currentFilePath(): string {
  if (!_currentFilename) {
    _currentFilename = newFilename();
  }
  return resolve(LOGS_DIR, _currentFilename);
}

/** Flush buffer to disk as a complete JSON file. */
function flushToDisk(filePath: string, events: unknown[]): void {
  try {
    ensureLogsDir();
    const payload = {
      generated: new Date().toISOString(),
      event_count: events.length,
      events,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Best-effort — never throw from logging
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Whether local logging is currently enabled. */
export function isLoggingEnabled(): boolean {
  return _enabled;
}

/** Enable local logging (default on startup). */
export function enableLogging(): void {
  _enabled = true;
}

/**
 * Disable local logging (opt-out).
 *
 * TODO (deferred): This function exists but is not yet reachable at runtime via
 * any MCP tool. A `toggle_logging` (or `set_logging`) tool that calls
 * enableLogging()/disableLogging() based on a boolean parameter should be added
 * and registered in server.ts to expose this control to agents. Deferred because
 * the task spec does not define the exact tool interface for the toggle mechanism.
 */
export function disableLogging(): void {
  _enabled = false;
}

/** Get the current log filename (may be null if no events yet). */
export function getCurrentLogFilename(): string | null {
  return _currentFilename;
}

/**
 * Append an event to the current log buffer.
 * The buffer is written on roll() or at shutdown.
 * No-op if logging is disabled.
 */
export function logEvent(event: unknown): void {
  if (!_enabled) return;
  _buffer.push(event);
  // Ensure filename is assigned even before roll
  currentFilePath();
}

/**
 * Roll the current log:
 *  1. Flush current buffer to the current file.
 *  2. Start a fresh file.
 *  3. Returns the filename that was just closed (or null if buffer was empty).
 */
export function rollLog(): string | null {
  if (_buffer.length === 0 && _currentFilename === null) {
    // Nothing to roll — create a new file but return null
    _currentFilename = newFilename();
    return null;
  }

  // Flush current
  const filePath = currentFilePath();
  const filename = _currentFilename!;
  flushToDisk(filePath, _buffer);

  // Reset for new file
  _buffer = [];
  _currentFilename = newFilename();

  return filename;
}

/**
 * Flush the current buffer to disk without rolling.
 * Used at shutdown to preserve in-flight events.
 */
export function flushCurrentLog(): void {
  if (_buffer.length === 0) return;
  const filePath = currentFilePath();
  flushToDisk(filePath, _buffer);
}

/**
 * Read a log file by filename and return its content as a string.
 * Throws if the file doesn't exist or the filename is unsafe.
 */
export function getLog(filename: string): string {
  const safe = sanitizeFilename(filename);
  const filePath = resolve(LOGS_DIR, safe);
  if (!existsSync(filePath)) {
    throw new Error(`Log file not found: ${safe}`);
  }
  return readFileSync(filePath, "utf-8");
}

/**
 * Delete a log file by filename.
 * Throws if the file doesn't exist or the filename is unsafe.
 */
export function deleteLog(filename: string): void {
  const safe = sanitizeFilename(filename);
  const filePath = resolve(LOGS_DIR, safe);
  if (!existsSync(filePath)) {
    throw new Error(`Log file not found: ${safe}`);
  }
  unlinkSync(filePath);
}

/**
 * List all log files in data/logs/, sorted by name (oldest first).
 * Returns filenames only (not full paths).
 */
export function listLogs(): string[] {
  if (!existsSync(LOGS_DIR)) return [];
  try {
    return readdirSync(LOGS_DIR)
      .filter(f => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Sanitize a filename: only allow YYYY-MM-DDTHHMMSS.json format to
 * prevent path traversal attacks.
 */
function sanitizeFilename(filename: string): string {
  // Strip any directory components
  const base = basename(filename);
  // Allow only timestamped .json files
  if (!/^\d{4}-\d{2}-\d{2}T\d{6}\.json$/.test(base)) {
    throw new Error(`Invalid log filename: ${base}`);
  }
  return base;
}

/** Reset state for testing only. */
export function resetLocalLogForTest(): void {
  _enabled = true;
  _currentFilename = null;
  _buffer = [];
}
