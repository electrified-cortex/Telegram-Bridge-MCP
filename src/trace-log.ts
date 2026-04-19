/**
 * Behavioral audit trace log — always-on, bounded, in-memory ring buffer.
 *
 * Records every tool invocation and key non-tool events for behavioral
 * auditing ("did agent X actually call dequeue?").
 *
 * Unlike debug-log, this is always enabled (not gated by a toggle).
 * Ring buffer holds up to 10,000 entries; oldest are evicted when full.
 *
 * Access control:
 *   - Governor (getGovernorSid()) may query any session.
 *   - Non-governor callers are restricted to their own sid.
 */

import { getGovernorSid } from "./routing-mode.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceEventType =
  | "tool_call"
  | "tool_blocked"
  | "reminder_fire"
  | "session_create"
  | "session_close"
  | "message_deliver";

export interface TraceEntry {
  seq: number;                           // monotonically incrementing sequence number
  ts: string;                            // ISO-8601 timestamp
  sid: number;                           // session ID (0 = unknown/system)
  session_name: string;                  // session name at time of event
  event_type: TraceEventType;
  tool?: string;                         // tool name (tool_call / tool_blocked only)
  params?: Record<string, unknown>;      // sanitized call params
  result?: "ok" | "error" | "blocked";  // outcome (tool_call / tool_blocked only)
  error_code?: string;                   // error code on failure
  detail?: string;                       // free-form detail for non-tool events
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;
const _buffer: TraceEntry[] = [];
let _nextSeq = 1;

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_RE = /token|pin|secret/i;

/**
 * Strip fields whose names match the sensitive-key pattern.
 * Operates shallowly — only top-level keys are filtered.
 */
function sanitizeParams(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEY_RE.test(k)) continue;
    result[k] = v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal push helper
// ---------------------------------------------------------------------------

function pushEntry(entry: TraceEntry): void {
  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) {
    _buffer.splice(0, _buffer.length - MAX_ENTRIES);
  }
}

// ---------------------------------------------------------------------------
// Public API — record events
// ---------------------------------------------------------------------------

/**
 * Record a tool call outcome (always-on, regardless of debug mode).
 *
 * @param toolName     - MCP tool name
 * @param args         - raw call arguments (will be sanitized before storage)
 * @param sid          - session ID extracted from token
 * @param sessionName  - session display name
 * @param result       - outcome: "ok" | "error" | "blocked"
 * @param errorCode    - optional error code on failure/blocked
 */
export function recordToolCall(
  toolName: string,
  args: Record<string, unknown>,
  sid: number,
  sessionName: string,
  result: "ok" | "error" | "blocked",
  errorCode?: string,
): void {
  const entry: TraceEntry = {
    seq: _nextSeq++,
    ts: new Date().toISOString(),
    sid,
    session_name: sessionName,
    event_type: result === "blocked" ? "tool_blocked" : "tool_call",
    tool: toolName,
    params: sanitizeParams(args),
    result,
    ...(errorCode !== undefined && { error_code: errorCode }),
  };
  pushEntry(entry);
}

/**
 * Record a non-tool lifecycle event.
 *
 * @param type        - event type
 * @param sid         - session ID
 * @param sessionName - session display name
 * @param detail      - optional free-form detail string
 */
export function recordNonToolEvent(
  type: TraceEventType,
  sid: number,
  sessionName: string,
  detail?: string,
): void {
  const entry: TraceEntry = {
    seq: _nextSeq++,
    ts: new Date().toISOString(),
    sid,
    session_name: sessionName,
    event_type: type,
    ...(detail !== undefined && { detail }),
  };
  pushEntry(entry);
}

// ---------------------------------------------------------------------------
// Public API — query
// ---------------------------------------------------------------------------

export interface TraceQueryOpts {
  /** Filter to a specific session. */
  sid?: number;
  /** Filter to a specific tool name. */
  tool?: string;
  /** Only entries at or after this ISO timestamp. */
  since_ts?: string;
  /** Only entries with seq > this value (cursor-based pagination). */
  since_seq?: number;
  /** Maximum entries to return (default 100). */
  limit?: number;
  /** SID of the caller — used for access control. */
  caller_sid?: number;
  /** SID of the governor — governor sees all; non-governors restricted to own sid. */
  governor_sid?: number;
}

/**
 * Query the trace log with optional filters and access control.
 *
 * Non-governor callers are silently restricted to their own sid.
 * Governor (governor_sid matches caller_sid) may query any session.
 */
export function getTraceLog(opts: TraceQueryOpts = {}): TraceEntry[] {
  const {
    sid,
    tool,
    since_ts,
    since_seq,
    limit = 100,
  } = opts;

  const callerSid = opts.caller_sid ?? 0;
  // Resolve governor at query time if not supplied by caller.
  const governorSid = opts.governor_sid ?? getGovernorSid();
  const isGovernor = governorSid > 0 && callerSid === governorSid;

  // Non-governor callers with callerSid=0 (anonymous/system) get no results.
  if (!isGovernor && callerSid <= 0) {
    return [];
  }

  // Non-governor callers are restricted to their own sid.
  const effectiveSid = isGovernor ? sid : callerSid;

  let source = _buffer;

  if (since_seq !== undefined) {
    source = source.filter(e => e.seq > since_seq);
  }
  if (since_ts !== undefined) {
    source = source.filter(e => e.ts >= since_ts);
  }
  if (effectiveSid !== undefined && effectiveSid > 0) {
    source = source.filter(e => e.sid === effectiveSid);
  }
  if (tool !== undefined) {
    source = source.filter(e => e.tool === tool);
  }

  return source.slice(-limit);
}

// ---------------------------------------------------------------------------
// Public API — misc
// ---------------------------------------------------------------------------

/** Returns current number of entries in the ring buffer. */
export function traceLogSize(): number {
  return _buffer.length;
}

/** Clear the trace buffer. Called via `action(type: 'log/delete', filename: 'trace')`. */
export function clearTraceLog(): void {
  _buffer.length = 0;
  _nextSeq = 1;
}

/** Clear the buffer. For tests only. */
export function resetTraceLogForTest(): void {
  _buffer.length = 0;
  _nextSeq = 1;
}

