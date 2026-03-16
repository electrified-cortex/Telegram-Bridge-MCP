/**
 * Debug logging — structured, bounded, toggle-able trace log.
 *
 * Writes to stderr when enabled (visible in MCP client logs).
 * Stores entries in a bounded in-memory ring buffer queryable
 * via the /debug built-in command or dump_session_record.
 *
 * Enable via:
 *   - TELEGRAM_MCP_DEBUG=1 env var (enables at startup)
 *   - /debug built-in command (toggles at runtime)
 *
 * Categories keep events organized and filterable:
 *   session   — create, close, switch, auth attempts
 *   route     — routing decisions (targeted, LB, cascade, governor)
 *   queue     — enqueue, dequeue, pending counts
 *   cascade   — pass, timeout, deadline
 *   dm        — DM permission requests, deliveries
 *   animation — start, stop, promote, 429 recovery
 *   tool      — tool call entry/exit, errors
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebugCategory =
  | "session"
  | "route"
  | "queue"
  | "cascade"
  | "dm"
  | "animation"
  | "tool";

export interface DebugEntry {
  id: number;           // auto-incrementing sequence number
  ts: string;           // ISO-8601 timestamp
  cat: DebugCategory;   // category
  msg: string;          // human-readable summary
  data?: Record<string, unknown>; // structured payload
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 2000;
const _buffer: DebugEntry[] = [];
let _enabled = false; // set by initDebugLog() after config loads
let _nextId = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Initialize debug logging from config. Call after loadConfig(). */
export function initDebugLog(configEnabled: boolean): void {
  _enabled = configEnabled;
}

/** Whether debug logging is currently active. */
export function isDebugEnabled(): boolean {
  return _enabled;
}

/** Toggle debug mode. Returns the new state. */
export function setDebugEnabled(on: boolean): boolean {
  _enabled = on;
  return _enabled;
}

/**
 * Log a debug event. No-op when disabled.
 *
 * Writes a one-line summary to stderr and appends to the ring buffer.
 */
export function dlog(cat: DebugCategory, msg: string, data?: Record<string, unknown>): void {
  if (!_enabled) return;

  const entry: DebugEntry = {
    id: _nextId++,
    ts: new Date().toISOString(),
    cat,
    msg,
    ...(data !== undefined && { data }),
  };

  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) _buffer.splice(0, _buffer.length - MAX_ENTRIES);

  const dataStr = data ? " " + JSON.stringify(data) : "";
  process.stderr.write(`[dbg:${cat}] ${msg}${dataStr}\n`);
}

/**
 * Return the last N entries, optionally filtered by category.
 * Most recent entries come last (chronological order).
 */
export function getDebugLog(count = 50, category?: DebugCategory, since?: number): DebugEntry[] {
  let source = _buffer;
  if (since !== undefined) source = source.filter(e => e.id > since);
  if (category) source = source.filter(e => e.cat === category);
  return source.slice(-count);
}

/** Number of entries currently in the buffer. */
export function debugLogSize(): number {
  return _buffer.length;
}

/** Clear all buffered entries. */
export function clearDebugLog(): void {
  _buffer.length = 0;
}

/** Reset for tests. */
export function resetDebugLogForTest(): void {
  _buffer.length = 0;
  _enabled = false;
  _nextId = 1;
}
