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

import { mkdirSync, readFileSync, unlinkSync, readdirSync, existsSync } from "fs";
import { appendFile } from "fs/promises";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import Queue from "@tsdotnet/queue";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, "..", "data", "logs");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _enabled = true;
let _currentFilename: string | null = null;
const _buffer = new Queue<string>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _flushPromise: Promise<void> = Promise.resolve();
const FLUSH_DELAY_MS = 500;

/** Validates that a filename matches the YYYY-MM-DDTHHMMSS.json pattern. */
const TIMESTAMP_FILENAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}\.json$/;

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

// Files use .json extension with NDJSON content (one JSON object per line).
// .json is retained for backward compatibility; each line is individually valid JSON.
function newFilename(): string {
  return `${formatTimestamp(new Date())}.json`;
}

function currentFilePath(): string {
  if (!_currentFilename) {
    _currentFilename = newFilename();
  }
  return resolve(LOGS_DIR, _currentFilename);
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
 */
export function disableLogging(): void {
  _enabled = false;
}

/** Get the current log filename (may be null if no events yet). */
export function getCurrentLogFilename(): string | null {
  return _currentFilename;
}

/**
 * Buffers an event in memory and schedules a flush after 500 ms.
 * No-op if logging is disabled.
 */
export function logEvent(event: unknown): void {
  if (!_enabled) return;
  currentFilePath(); // eagerly initialize _currentFilename so rollLog/getCurrentLogFilename work immediately
  _buffer.enqueue(JSON.stringify({ ts: new Date().toISOString(), event }) + '\n');
  if (_flushTimer === null) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      _flushPromise = _flushPromise.then(_actualFlush, (error) => {
        console.error("local-log: previous flush failed", error);
        return _actualFlush();
      });
    }, FLUSH_DELAY_MS);
  }
}

/** Drain the buffer and append to the current log file. */
async function _actualFlush(): Promise<void> {
  if (_buffer.count === 0) return;
  const lines: string[] = [];
  while (_buffer.count > 0) {
    const line = _buffer.dequeue();
    if (line === undefined) break;
    lines.push(line);
  }
  ensureLogsDir();
  const filePath = currentFilePath();
  await appendFile(filePath, lines.join(''), 'utf-8').catch(() => { /* best-effort */ });
}

/**
 * Roll the current log:
 *  1. Captures the current filename.
 *  2. Resets _currentFilename so the next event opens a new file.
 *  3. Returns the filename that was just closed (or null if nothing logged yet).
 */
export function rollLog(): string | null {
  if (_currentFilename === null) return null;
  const filename = _currentFilename;
  _currentFilename = null;
  return filename;
}

/**
 * Cancel any pending timer, drain the buffer, and await the write.
 * Call before shutdown or roll to ensure no buffered events are lost.
 */
export async function flushCurrentLog(): Promise<void> {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  // Chain the drain onto any in-flight flush so writes are serialized.
  _flushPromise = _flushPromise.then(_actualFlush, (error) => {
    console.error("local-log: previous flush failed", error);
    return _actualFlush();
  });
  await _flushPromise;
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
  if (_currentFilename !== null && safe === _currentFilename) {
    throw new Error("Cannot delete active log — roll first");
  }
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
      .filter(f => TIMESTAMP_FILENAME_RE.test(f) && f !== _currentFilename)
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
  if (!TIMESTAMP_FILENAME_RE.test(base)) {
    throw new Error(`Invalid log filename: ${base}`);
  }
  return base;
}

/** Reset state for testing only. */
export function resetLocalLogForTest(): void {
  _enabled = true;
  _currentFilename = null;
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  _flushPromise = Promise.resolve();
  // Drain the buffer without writing
  while (_buffer.count > 0) _buffer.dequeue();
}
