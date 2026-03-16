import { randomInt } from "node:crypto";

// ── Types ──────────────────────────────────────────────────

export interface Session {
  sid: number;
  pin: number;
  name: string;
  createdAt: string;
}

/** Public view returned by `listSessions` — no PIN. */
export interface SessionInfo {
  sid: number;
  name: string;
  createdAt: string;
}

/** Value returned from `createSession`. */
export interface SessionCreateResult {
  sid: number;
  pin: number;
  name: string;
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

// ── Public API ─────────────────────────────────────────────

export function createSession(name = ""): SessionCreateResult {
  const sid = _nextId++;
  const pin = generatePin();
  const session: Session = {
    sid,
    pin,
    name,
    createdAt: new Date().toISOString(),
  };
  _sessions.set(sid, session);
  return { sid, pin, name, sessionsActive: _sessions.size };
}

export function getSession(sid: number): Session | undefined {
  return _sessions.get(sid);
}

export function validateSession(sid: number, pin: number): boolean {
  const session = _sessions.get(sid);
  return session !== undefined && session.pin === pin;
}

export function closeSession(sid: number): boolean {
  return _sessions.delete(sid);
}

export function listSessions(): SessionInfo[] {
  return [..._sessions.values()].map(({ sid, name, createdAt }) => ({
    sid,
    name,
    createdAt,
  }));
}

export function activeSessionCount(): number {
  return _sessions.size;
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
  _activeSessionId = sid;
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
