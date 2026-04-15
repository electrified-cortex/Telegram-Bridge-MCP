import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dlog } from "./debug-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the simple session-state file at the project root. */
export const SESSION_STATE_PATH = resolve(__dirname, "..", "session-state.json");

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

export interface PersistedSessionState {
  nextId: number;
  sessions: Array<{ sid: number; pin: number; name: string; color: string; createdAt: string }>;
  plannedBounce?: boolean;
}

// ── Types ──────────────────────────────────────────────────

/** Emoji color squares assigned to sessions in rainbow order. */
export const COLOR_PALETTE = ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"] as const;
export type SessionColor = (typeof COLOR_PALETTE)[number];

export interface Session {
  sid: number;
  pin: number;
  name: string;
  color: string;
  createdAt: string;
  lastPollAt: number | undefined;
  healthy: boolean;
  announcementMsgId?: number;
  reauthDialogMsgId?: number;
  dequeueDefault?: number; // per-session timeout default, undefined = use server default (300)
  dequeueIdleAt?: number; // timestamp when session entered dequeue blocking wait; undefined = not idle
}

/** Public view returned by `listSessions` — no PIN. */
export interface SessionInfo {
  sid: number;
  name: string;
  color: string;
  createdAt: string;
}

/** Value returned from `createSession`. */
export interface SessionCreateResult {
  sid: number;
  pin: number;
  name: string;
  color: string;
  sessionsActive: number;
}

// ── State ──────────────────────────────────────────────────

const PIN_MIN = 100_000;
const PIN_MAX = 999_999;

let _nextId = 1;
const _sessions = new Map<number, Session>();

/**
 * SIDs that were restored from a snapshot and have not yet been confirmed by a
 * successful `session/restore` token exchange. Restored sessions are not fully
 * live until the agent proves it holds the original token.
 */
const _restoredSids = new Set<number>();

/**
 * LRU color queue. Index 0 = least recently used (freshest for next assignment);
 * last index = most recently used. Initialized to palette definition order —
 * all colors are equally "never used" at startup.
 */
let _colorLRU: string[] = [...COLOR_PALETTE];

/** Colors that have been assigned at least once since last reset. */
const _everUsedColors = new Set<string>();

// ── Helpers ────────────────────────────────────────────────

function generatePin(): number {
  return randomInt(PIN_MIN, PIN_MAX + 1);
}

/** Move a color to the MRU (far right) position in the LRU queue and mark it as ever-used. */
function recordColorUse(color: string): void {
  _everUsedColors.add(color);
  const idx = _colorLRU.indexOf(color);
  if (idx !== -1) {
    _colorLRU.splice(idx, 1);
    _colorLRU.push(color);
  }
}

/**
 * Pick a color from the palette.
 *
 * - `force = true` (operator explicit tap): assign `requested` unconditionally —
 *   even if it is already held by another active session.
 * - `force = false` (agent suggestion / auto): use `requested` only when it is
 *   free; otherwise auto-assign the least-recently-used free color (leftmost in
 *   the LRU queue). If all 6 colors are taken, wrap around by session count.
 *
 * Records the assigned color in the LRU queue regardless of how it was chosen.
 */
function assignColor(requested?: string, force = false): string {
  const usedColors = new Set([..._sessions.values()].map((s) => s.color));
  let color: string;
  if (requested && (COLOR_PALETTE as readonly string[]).includes(requested)) {
    if (force || !usedColors.has(requested)) {
      color = requested;
    } else {
      // Suggested color is in use and not forced — fall back to LRU auto-assign
      color = _colorLRU.find(c => !usedColors.has(c))
        ?? COLOR_PALETTE[_sessions.size % COLOR_PALETTE.length];
    }
  } else {
    // No valid suggestion — auto-assign least-recently-used free color
    color = _colorLRU.find(c => !usedColors.has(c))
      ?? COLOR_PALETTE[_sessions.size % COLOR_PALETTE.length];
  }
  recordColorUse(color);
  return color;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Returns all palette colors sorted so that **currently unused colors appear
 * first** (LRU order within group) and **currently in-use colors appear last**
 * (LRU order within group).
 *
 * If `hint` is a valid palette color, it is always moved to index 0 (first
 * position) regardless of whether it is currently in use by another session.
 *
 * All 6 colors are always returned regardless of current active-session usage.
 */
export function getAvailableColors(hint?: string): string[] {
  const usedColors = new Set([..._sessions.values()].map((s) => s.color));
  const allColors = [..._colorLRU]; // LRU order: [0]=least-recently-used … [5]=most-recently-used

  // Sort: unused colors first (LRU order within group), in-use colors last
  const sorted = [
    ...allColors.filter(c => !usedColors.has(c)),
    ...allColors.filter(c => usedColors.has(c)),
  ];

  if (hint && (COLOR_PALETTE as readonly string[]).includes(hint)) {
    // Always promote hint to position 0 — this is the agent's requested color
    // and should be the most prominent button in the approval dialog.
    // In-use hints are still promoted (sessions may share colors).
    return [hint, ...sorted.filter(c => c !== hint)];
  }
  return sorted;
}

export function createSession(name = "", colorHint?: string, forceColor = false): SessionCreateResult {
  const sid = _nextId++;
  const usedPins = new Set([..._sessions.values()].map((s) => s.pin));
  let pin: number;
  const MAX_PIN_ATTEMPTS = 10;
  let attempt = 0;
  do {
    pin = generatePin();
    attempt++;
  } while (usedPins.has(pin) && attempt < MAX_PIN_ATTEMPTS);
  if (usedPins.has(pin)) {
    throw new Error(
      `[session-manager] Failed to generate a unique PIN after ${MAX_PIN_ATTEMPTS} attempts.`,
    );
  }
  const color = assignColor(colorHint, forceColor);
  const session: Session = {
    sid,
    pin,
    name,
    color,
    createdAt: new Date().toISOString(),
    lastPollAt: undefined,
    healthy: true,
  };
  _sessions.set(sid, session);
  dlog("session", `created sid=${sid} name=${JSON.stringify(name)} color=${color} total=${_sessions.size}`);
  persistSessions();
  return { sid, pin, name, color, sessionsActive: _sessions.size };
}

export function getSession(sid: number): Session | undefined {
  return _sessions.get(sid);
}

export function validateSession(sid: number, pin: number): boolean {
  const session = _sessions.get(sid);
  return session !== undefined && session.pin === pin;
}

export function closeSession(sid: number): boolean {
  const deleted = _sessions.delete(sid);
  if (deleted) {
    dlog("session", `closed sid=${sid} remaining=${_sessions.size}`);
    persistSessions();
  }
  return deleted;
}

export function listSessions(): SessionInfo[] {
  return [..._sessions.values()].map(({ sid, name, color, createdAt }) => ({
    sid,
    name,
    color,
    createdAt,
  }));
}

export function activeSessionCount(): number {
  return _sessions.size;
}

/** Record a heartbeat for a session — called by dequeue on every poll. */
export function touchSession(sid: number): void {
  const s = _sessions.get(sid);
  if (!s) return;
  s.lastPollAt = Date.now();
  s.healthy = true;
}

/** Mark a session as unhealthy (called by the health-check timer). */
export function markUnhealthy(sid: number): void {
  const s = _sessions.get(sid);
  if (s) s.healthy = false;
}

/** Return true if the session is tracked as healthy. */
export function isHealthy(sid: number): boolean {
  return _sessions.get(sid)?.healthy ?? false;
}

/**
 * Return sessions whose last poll was older than `thresholdMs` ago.
 * Sessions that have never polled (lastPollAt === undefined) are excluded —
 * they may legitimately be starting up.
 */
export function getUnhealthySessions(thresholdMs: number): SessionInfo[] {
  const cutoff = Date.now() - thresholdMs;
  return [..._sessions.values()]
    .filter(s => s.lastPollAt !== undefined && s.lastPollAt < cutoff)
    .map(({ sid, name, color, createdAt }) => ({ sid, name, color, createdAt }));
}

// ── Dequeue Default ───────────────────────────────────────

const DEFAULT_DEQUEUE_TIMEOUT = 300;

/**
 * Return the per-session dequeue timeout default for a session.
 * Returns the server default (300 s) if no per-session default has been set
 * or the session does not exist.
 */
export function getDequeueDefault(sid: number): number {
  return _sessions.get(sid)?.dequeueDefault ?? DEFAULT_DEQUEUE_TIMEOUT;
}

/**
 * Set the per-session dequeue timeout default.
 * Scoped to the session lifetime — cleared when the session closes.
 * No-op if the session does not exist.
 */
export function setDequeueDefault(sid: number, timeout: number): void {
  const session = _sessions.get(sid);
  if (session) session.dequeueDefault = timeout;
}

// ── Active Session Context ─────────────────────────────────

/**
 * The session ID of the currently-executing tool call.
 * 0 = no session (single-session backward compat / bootstrap tools).
 *
 * Safe for stdio (one tool call at a time). For HTTP transport with
 * concurrent sessions, replace with AsyncLocalStorage.
 */
let _activeSessionId = 0;

export function setActiveSession(sid: number): void {
  const prev = _activeSessionId;
  _activeSessionId = sid;
  if (prev !== sid) dlog("session", `active ${prev} → ${sid}`);
}

export function getActiveSession(): number {
  return _activeSessionId;
}

/** Clear all sessions, reset the ID counter, and reset the color LRU queue. Test-only. */
export function resetSessions(): void {
  _sessions.clear();
  _nextId = 1;
  _activeSessionId = 0;
  _colorLRU = [...COLOR_PALETTE];
  _everUsedColors.clear();
  _restoredSids.clear();
}

/** Store the message ID of the session's online announcement for later unpin. */
export function setSessionAnnouncementMessage(sid: number, msgId: number): void {
  const s = _sessions.get(sid);
  if (s) s.announcementMsgId = msgId;
}

/** Return the stored announcement message ID for a session, if any. */
export function getSessionAnnouncementMessage(sid: number): number | undefined {
  return _sessions.get(sid)?.announcementMsgId;
}

/** Store the message ID of the pending reconnect approval dialog for auto-dismiss. */
export function setSessionReauthDialogMsgId(sid: number, msgId: number): void {
  const s = _sessions.get(sid);
  if (s) s.reauthDialogMsgId = msgId;
}

/** Clear the stored reauth dialog message ID (after dismiss or dialog resolved). */
export function clearSessionReauthDialogMsgId(sid: number): void {
  const s = _sessions.get(sid);
  if (s) s.reauthDialogMsgId = undefined;
}

/** Return the stored reauth dialog message ID for a session, if any. */
export function getSessionReauthDialogMsgId(sid: number): number | undefined {
  return _sessions.get(sid)?.reauthDialogMsgId;
}

/** Mark a session as idle (entering dequeue blocking wait) or active (returning from it). */
export function setDequeueIdle(sid: number, idle: boolean): void {
  const s = _sessions.get(sid);
  if (!s) return;
  s.dequeueIdleAt = idle ? Date.now() : undefined;
}

/** Return sessions currently in a blocking dequeue wait, with idle duration in ms. */
export function getIdleSessions(): Array<SessionInfo & { idle_since_ms: number }> {
  const now = Date.now();
  return [..._sessions.values()]
    .map((s) => {
      if (s.dequeueIdleAt === undefined) return undefined;
      return {
        sid: s.sid,
        name: s.name,
        color: s.color,
        createdAt: s.createdAt,
        idle_since_ms: now - s.dequeueIdleAt,
      };
    })
    .filter((s): s is SessionInfo & { idle_since_ms: number } => s !== undefined);
}

// ── Snapshot Restore ───────────────────────────────────────

export interface RestoredSessionSnapshot {
  sid: number;
  pin: number;
  name: string;
  color: string;
  createdAt: string;
  dequeueDefault?: number;
}

/**
 * Restore sessions from a persisted snapshot.
 *
 * Sessions are added to `_sessions` in "restored-unconfirmed" state:
 *   - `healthy: false`  — not proven live yet
 *   - `lastPollAt: undefined` — no poll on record
 *
 * `_nextId` is seeded above the highest restored SID so future `createSession`
 * calls produce IDs that do not collide with any restored session.
 */
export function restoreSessionsFromSnapshot(sessions: RestoredSessionSnapshot[]): void {
  let maxSid = 0;
  for (const snap of sessions) {
    const session: Session = {
      sid: snap.sid,
      pin: snap.pin,
      name: snap.name,
      color: snap.color,
      createdAt: snap.createdAt,
      lastPollAt: undefined,
      healthy: false,
      ...(snap.dequeueDefault !== undefined && { dequeueDefault: snap.dequeueDefault }),
    };
    _sessions.set(snap.sid, session);
    _restoredSids.add(snap.sid);
    if (snap.sid > maxSid) maxSid = snap.sid;
    dlog("session", `restored sid=${snap.sid} name=${JSON.stringify(snap.name)}`);
  }
  if (maxSid >= _nextId) {
    _nextId = maxSid + 1;
  }
  dlog("session", `restoreSessionsFromSnapshot count=${sessions.length} nextId=${_nextId}`);
}

/** Returns true if `sid` is in the restored-unconfirmed set. */
export function isRestoredSession(sid: number): boolean {
  return _restoredSids.has(sid);
}

/**
 * Remove `sid` from the restored-unconfirmed set.
 * Called after a successful `session/restore` token exchange.
 */
export function markSessionRestored(sid: number): void {
  _restoredSids.delete(sid);
  dlog("session", `markSessionRestored sid=${sid}`);
}

/**
 * Clear the entire restored-unconfirmed set.
 * Called by `expireRestoredSessions` (5-minute startup timeout) to ensure stale
 * snapshots cannot permanently bypass operator approval.
 */
export function resetRestoredSids(): void {
  _restoredSids.clear();
  dlog("session", "resetRestoredSids — all restored SIDs expired");
}

/**
 * Returns the session object only if `sid` is currently in the
 * restored-unconfirmed set. Returns undefined if the session does not exist
 * or has already been confirmed.
 */
export function getRestoredSessionBySid(sid: number): Session | undefined {
  if (!_restoredSids.has(sid)) return undefined;
  return _sessions.get(sid);
}

/**
 * Rename a session. Sets the name unconditionally — callers are responsible
 * for uniqueness validation before calling (see `rename_session.ts` tool for
 * the case-insensitive collision guard). Returns `{ old_name, new_name }` on
 * success or `null` if the session does not exist.
 */
export function renameSession(
  sid: number,
  newName: string,
): { old_name: string; new_name: string } | null {
  const session = _sessions.get(sid);
  if (!session) return null;
  const old_name = session.name;
  session.name = newName;
  dlog("session", `renamed sid=${sid} "${old_name}" → "${newName}"`);
  persistSessions();
  return { old_name, new_name: newName };
}

// ---------------------------------------------------------------------------
// Simple session persistence (bounce protocol)
// ---------------------------------------------------------------------------

/**
 * Write current sessions and `_nextId` to `session-state.json` at the project
 * root. Sets `plannedBounce: false` so a plain persist does not trigger the
 * fast-reconnect path on next startup. Best-effort — swallows all errors.
 */
export function persistSessions(): void {
  try {
    const state: PersistedSessionState = {
      nextId: _nextId,
      sessions: [..._sessions.values()].map(({ sid, pin, name, color, createdAt }) => ({
        sid,
        pin,
        name,
        color,
        createdAt,
      })),
      plannedBounce: false,
    };
    writeFileSync(SESSION_STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort — ignore disk errors
  }
}

/**
 * Read `session-state.json` and restore sessions into `_sessions`.
 * Seeds `_nextId` to `max(SIDs) + 1` to avoid collisions.
 * Immediately clears `plannedBounce` from the file after reading.
 *
 * Returns `true` if the file contained `plannedBounce: true` (planned bounce),
 * `false` otherwise. No-op and returns `false` if the file is absent or invalid.
 */
export function restoreSessions(): boolean {
  if (!existsSync(SESSION_STATE_PATH)) return false;
  let state: PersistedSessionState;
  try {
    const raw = readFileSync(SESSION_STATE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    state = parsed as PersistedSessionState;
    if (!Array.isArray(state.sessions)) return false;
  } catch {
    return false;
  }

  const wasPlanned = state.plannedBounce === true;

  // Restore sessions
  let maxSid = 0;
  for (const snap of state.sessions) {
    const session: Session = {
      sid: snap.sid,
      pin: snap.pin,
      name: snap.name,
      color: snap.color,
      createdAt: snap.createdAt,
      lastPollAt: undefined,
      healthy: false,
    };
    _sessions.set(snap.sid, session);
    _restoredSids.add(snap.sid);
    if (snap.sid > maxSid) maxSid = snap.sid;
  }
  _nextId = maxSid + 1;
  if (typeof state.nextId === "number" && state.nextId > _nextId) {
    _nextId = state.nextId;
  }
  dlog("session", `restoreSessions count=${state.sessions.length} nextId=${_nextId} planned=${wasPlanned}`);

  // Clear plannedBounce from file immediately after reading
  try {
    const cleared: PersistedSessionState = { ...state, plannedBounce: false };
    writeFileSync(SESSION_STATE_PATH, JSON.stringify(cleared, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort
  }

  return wasPlanned;
}

/**
 * Write current in-memory sessions to `session-state.json` with
 * `plannedBounce: true`. Called during `elegantShutdown(planned: true)` so
 * the next startup knows it was a deliberate bounce and can skip reconnect
 * approval. Always builds from `_sessions` (never re-reads disk) so any
 * in-memory changes made since the last `persistSessions()` call are captured.
 * Best-effort — swallows all errors.
 */
export function markPlannedBounce(): void {
  try {
    const state: PersistedSessionState = {
      nextId: _nextId,
      sessions: Array.from(_sessions.values()).map(s => ({
        sid: s.sid, pin: s.pin, name: s.name, color: s.color, createdAt: s.createdAt,
      })),
      plannedBounce: true,
    };
    writeFileSync(SESSION_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch { /* best-effort */ }
}
