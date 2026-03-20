import { randomInt } from "node:crypto";
import { dlog } from "./debug-log.js";

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

// ── Helpers ────────────────────────────────────────────────

function generatePin(): number {
  return randomInt(PIN_MIN, PIN_MAX + 1);
}

/**
 * Pick a color from the palette. If `requested` is a valid palette color
 * not already in use, use it. Otherwise auto-assign the first unused
 * palette color. If all 6 are taken, wrap around by session count.
 */
function assignColor(requested?: string): string {
  const usedColors = new Set([..._sessions.values()].map((s) => s.color));
  if (requested && (COLOR_PALETTE as readonly string[]).includes(requested) && !usedColors.has(requested)) {
    return requested;
  }
  for (const c of COLOR_PALETTE) {
    if (!usedColors.has(c)) return c;
  }
  // All 6 taken — wrap around
  return COLOR_PALETTE[_sessions.size % COLOR_PALETTE.length] ?? COLOR_PALETTE[0];
}

// ── Public API ─────────────────────────────────────────────

/**
 * Returns colors available for a new session (not already in use by any active
 * session). If `hint` is a valid palette color that is available, it is placed
 * first. If all 6 colors are taken, returns all 6 (duplicates allowed).
 */
export function getAvailableColors(hint?: string): string[] {
  const usedColors = new Set([..._sessions.values()].map((s) => s.color));
  const available = (COLOR_PALETTE as readonly string[]).filter((c) => !usedColors.has(c));
  if (available.length === 0) return [...COLOR_PALETTE];
  if (hint && available.includes(hint)) {
    return [hint, ...available.filter((c) => c !== hint)];
  }
  return available;
}

export function createSession(name = "", colorHint?: string): SessionCreateResult {
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
  const color = assignColor(colorHint);
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
  if (deleted) dlog("session", `closed sid=${sid} remaining=${_sessions.size}`);
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

/** Record a heartbeat for a session — called by dequeue_update on every poll. */
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

/** Clear all sessions and reset the ID counter. Test-only. */
export function resetSessions(): void {
  _sessions.clear();
  _nextId = 1;
  _activeSessionId = 0;
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
  return { old_name, new_name: newName };
}
