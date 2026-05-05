import { randomInt, randomUUID } from "node:crypto";
import { dlog } from "./debug-log.js";
import { recordNonToolEvent } from "./trace-log.js";

// ── Types ──────────────────────────────────────────────────

/** Emoji color squares assigned to sessions in rainbow order. */
export const COLOR_PALETTE = ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"] as const;
export type SessionColor = (typeof COLOR_PALETTE)[number];

export interface Session {
  sid: number;
  suffix: number;
  name: string;
  color: string;
  createdAt: string;
  lastPollAt: number | undefined;
  healthy: boolean;
  announcementMsgId?: number;
  reauthDialogMsgId?: number;
  dequeueDefault?: number; // per-session timeout default, undefined = use server default (300)
  kickDebounceMs?: number; // per-session activity-file kick debounce window (ms), undefined = use default (60_000)
  dequeueIdleAt?: number; // timestamp when session entered dequeue blocking wait; undefined = not idle
  pendingEnvelopeHint?: string;
  silenceThresholdS?: number;
  firstUseHintsSeen?: Set<string>;
  nametag_emoji?: string;
  /**
   * Connection token assigned at session/start. Used for duplicate-session
   * detection: if two callers present the same SID/suffix but different
   * connection tokens, the bridge alerts the governor (Option A).
   */
  connectionToken: string;
  /**
   * Set when a `compacted` event fires for this session.
   * Cleared after the recovering animation is replaced with a persistent
   * "compacted" notify (one-shot per compaction cycle).
   */
  hasCompacted?: boolean;
}

/** Public view returned by `listSessions` — no token suffix. */
export interface SessionInfo {
  sid: number;
  name: string;
  color: string;
  createdAt: string;
}

/** Value returned from `createSession`. */
export interface SessionCreateResult {
  sid: number;
  suffix: number;
  name: string;
  color: string;
  sessionsActive: number;
  connectionToken: string;
}

// ── State ──────────────────────────────────────────────────

const SUFFIX_MIN = 100_000;
const SUFFIX_MAX = 999_999;

let _nextId = 1;
const _sessions = new Map<number, Session>();

/**
 * LRU color queue. Index 0 = least recently used (freshest for next assignment);
 * last index = most recently used. Initialized to palette definition order —
 * all colors are equally "never used" at startup.
 */
let _colorLRU: string[] = [...COLOR_PALETTE];

/** Colors that have been assigned at least once since last reset. */
const _everUsedColors = new Set<string>();

// ── Helpers ────────────────────────────────────────────────

function generateSuffix(): number {
  return randomInt(SUFFIX_MIN, SUFFIX_MAX + 1);
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
  const usedSuffixes = new Set([..._sessions.values()].map((s) => s.suffix));
  let suffix: number;
  const MAX_SUFFIX_ATTEMPTS = 10;
  let attempt = 0;
  do {
    suffix = generateSuffix();
    attempt++;
  } while (usedSuffixes.has(suffix) && attempt < MAX_SUFFIX_ATTEMPTS);
  if (usedSuffixes.has(suffix)) {
    throw new Error(
      `[session-manager] Failed to generate a unique token suffix after ${MAX_SUFFIX_ATTEMPTS} attempts.`,
    );
  }
  const color = assignColor(colorHint, forceColor);
  const connectionToken = randomUUID();
  const session: Session = {
    sid,
    suffix,
    name,
    color,
    createdAt: new Date().toISOString(),
    lastPollAt: undefined,
    healthy: true,
    connectionToken,
  };
  _sessions.set(sid, session);
  dlog("session", `created sid=${sid} name=${JSON.stringify(name)} color=${color} total=${_sessions.size}`);
  recordNonToolEvent("session_create", sid, name);
  return { sid, suffix, name, color, sessionsActive: _sessions.size, connectionToken };
}

export function getSession(sid: number): Session | undefined {
  return _sessions.get(sid);
}

export function validateSession(sid: number, suffix: number): boolean {
  const session = _sessions.get(sid);
  return session !== undefined && session.suffix === suffix;
}

/**
 * Return the connection token for a session, or undefined if the session
 * does not exist. Connection tokens are assigned at session/start and used
 * for duplicate-session detection (Option A).
 */
export function getConnectionToken(sid: number): string | undefined {
  return _sessions.get(sid)?.connectionToken;
}

/**
 * Check whether a presented connection token matches the one stored for the
 * given session. Returns:
 *   - "match"    — token matches; this is the expected caller
 *   - "mismatch" — token present but does not match; duplicate session detected
 *   - "absent"   — no token presented; legacy caller or caller that did not
 *                  save their connection token (non-fatal; allow through)
 *
 * Open design question: should we also issue a mismatch alert when the caller
 * presents a token but the session has no stored token (e.g. after a reconnect
 * that does not regenerate the token)? Currently treated as "match" to avoid
 * false positives.
 */
export function checkConnectionToken(
  sid: number,
  presented: string | undefined,
): "match" | "mismatch" | "absent" {
  if (presented === undefined) return "absent";
  const stored = _sessions.get(sid)?.connectionToken;
  if (!stored) return "match"; // no stored token → cannot verify, allow through
  return presented === stored ? "match" : "mismatch";
}

export function closeSession(sid: number): boolean {
  const session = _sessions.get(sid);
  const deleted = _sessions.delete(sid);
  if (deleted) {
    dlog("session", `closed sid=${sid} remaining=${_sessions.size}`);
    recordNonToolEvent("session_close", sid, session?.name ?? "");
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

// ── Silence Detection ─────────────────────────────────────

const SILENCE_THRESHOLD_DEFAULT_S = 30;
const SILENCE_THRESHOLD_FLOOR_S = 15;

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

/**
 * Get the per-session activity-file kick debounce window (ms).
 * Falls back to 60 000 ms if not set.
 */
export function getKickDebounceMs(sid: number): number {
  return _sessions.get(sid)?.kickDebounceMs ?? 60_000;
}

/**
 * Set the per-session activity-file kick debounce window (ms).
 * No-op if the session does not exist.
 */
export function setKickDebounceMs(sid: number, ms: number): void {
  const session = _sessions.get(sid);
  if (session) session.kickDebounceMs = ms;
}

/** Set a pending envelope hint to be included on the next dequeue response for this session. */
export function setSilenceHint(sid: number, hint: string): void {
  const s = _sessions.get(sid);
  if (s) s.pendingEnvelopeHint = hint;
}

/**
 * Consume and return the pending envelope hint for this session (if any).
 * Clears the hint so it is only included once.
 */
export function takeSilenceHint(sid: number): string | undefined {
  const s = _sessions.get(sid);
  if (!s) return undefined;
  const hint = s.pendingEnvelopeHint;
  s.pendingEnvelopeHint = undefined;
  return hint;
}

/**
 * Return the per-session silence-detection threshold in seconds.
 * Returns the session default (30 s) if none has been set or session doesn't exist.
 */
export function getSilenceThreshold(sid: number): number {
  return _sessions.get(sid)?.silenceThresholdS ?? SILENCE_THRESHOLD_DEFAULT_S;
}

/**
 * Set the per-session silence-detection threshold.
 * Clamped to a minimum of 15 s (SILENCE_THRESHOLD_FLOOR_S).
 * No-op if the session does not exist.
 */
export function setSilenceThreshold(sid: number, seconds: number): void {
  const s = _sessions.get(sid);
  if (s) s.silenceThresholdS = Math.max(SILENCE_THRESHOLD_FLOOR_S, Math.floor(seconds));
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

/**
 * Update a session's color. Returns the assigned color on success or `null`
 * if the session does not exist or the color is not a valid palette entry.
 */
export function setSessionColor(sid: number, color: string): string | null {
  if (!(COLOR_PALETTE as readonly string[]).includes(color)) return null;
  const session = _sessions.get(sid);
  if (!session) return null;
  session.color = color;
  recordColorUse(color);
  dlog("session", `color sid=${sid} → ${color}`);
  return color;
}


// ── First-Use Hints ────────────────────────────────────────

export function getOrInitHintsSeen(sid: number): Set<string> | null {
  const session = _sessions.get(sid);
  if (!session) return null;
  if (!session.firstUseHintsSeen) session.firstUseHintsSeen = new Set();
  return session.firstUseHintsSeen;
}

// ── Compaction Recovery ────────────────────────────────────

/** Mark that a `compacted` event has fired for this session. */
export function setHasCompacted(sid: number): void {
  const session = _sessions.get(sid);
  if (session) session.hasCompacted = true;
}

/** Clear the compacted flag (called after the one-shot recovery notify fires). */
export function clearHasCompacted(sid: number): void {
  const session = _sessions.get(sid);
  if (session) session.hasCompacted = false;
}

/** Return true if a `compacted` event has fired and the notify hasn't fired yet. */
export function getHasCompacted(sid: number): boolean {
  return !!_sessions.get(sid)?.hasCompacted;
}
