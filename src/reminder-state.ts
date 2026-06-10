/**
 * Per-session reminder state for the Scheduled Reminders feature.
 *
 * **Three-tier queue:**
 * - `deferred` — has a `delay_seconds` > 0 that has not yet elapsed. Cannot fire yet.
 * - `active`   — delay has elapsed (or was 0). Fires after 60 s of idle within `dequeue`.
 * - `startup`  — fires on the next `session_start` (including reconnects), not on a timer.
 * - `schedule` — wall-clock cron-based; fires when now >= next_fire_ms, checked in dequeue.
 *
 * Reminders are keyed by SID (per-session, all in-memory).
 */

import { createHash } from "crypto";
import { Cron } from "croner";
import { getCallerSid } from "./session-context.js";
import { kickSseSubscriber } from "./sse-endpoint.js";

/**
 * Deterministic reminder ID derived from content.
 * Same text+recurring+trigger+mode+only_if_silent always yields the same 16-char hex string.
 * Different `recurring` flag, `trigger`, `mode`, or `only_if_silent` → different hash (they coexist).
 */
export function reminderContentHash(
  text: string,
  recurring: boolean,
  trigger: "time" | "startup" | "last_sent" | "last_received" | "schedule" = "time",
  mode?: "all" | "operator",
  only_if_silent?: boolean,
): string {
  return createHash("sha256")
    .update(`${text}\0${recurring}\0${trigger}\0${mode ?? ""}\0${only_if_silent ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export interface Reminder {
  id: string;
  text: string;
  delay_seconds: number;
  recurring: boolean;
  trigger: "time" | "startup" | "last_sent" | "last_received" | "schedule";
  /** Only set for `last_received` reminders. Defaults to "all" if omitted. */
  mode?: "all" | "operator";
  /**
   * For `last_received` only: when true, suppresses the reminder if the agent has already
   * replied (sent) since the last qualifying inbound. Default false preserves v7.6.0 behavior.
   */
  only_if_silent?: boolean;
  created_at: number;      // Date.now() when added
  activated_at: number | null; // Date.now() when promoted to active (null if still deferred/startup)
  state: "deferred" | "active" | "startup" | "event_pending" | "schedule";
  /**
   * Persists across session restart / profile-save.
   * When true the reminder will not fire until re-enabled.
   */
  disabled?: boolean;
  /**
   * Transient sleep — epoch ms after which firing resumes.
   * NOT persisted to profile; lost on session end or profile/save.
   */
  sleep_until?: number;
  /**
   * For last_sent/last_received only: the last_event_at timestamp we last fired for.
   * Prevents re-firing for the same event. Set to the event timestamp on each fire.
   * Cleared implicitly when a new qualifying event arrives (new timestamp ≠ last_fired_for).
   */
  last_fired_for?: number;
  /** For `schedule` only: 5-field cron expression. */
  cron?: string;
  /** For `schedule` only: resolved IANA timezone (e.g. "America/New_York"). */
  tz?: string;
  /** For `schedule` only: epoch ms of the next fire. Runtime-only — not persisted. */
  next_fire_ms?: number;
}

const _reminders = new Map<number, Reminder[]>();
let _nextEventId = -10_000;

// ── Schedule sweep (shared, module-level) ─────────────────────────────────
// Single 5-second interval; starts on first reminder/schedule, stops when last is removed.
// Sends a kick (wake signal) when next_fire_ms is within 6 s. The actual fire happens
// in dequeue's in-loop check (popFireableScheduleReminders), not here.

const _scheduleSids = new Set<number>();
// FIX 4: per-reminder last-kicked dedup — tracks (sid → reminderId → last_kicked_fire_ms)
// Prevents duplicate SSE kicks when the same next_fire_ms falls within two consecutive sweep ticks.
const _lastKickedFireMs = new Map<number, Map<string, number>>();
let _sweepInterval: ReturnType<typeof setInterval> | null = null;
const SCHEDULE_SWEEP_INTERVAL_MS = 5_000;
const SCHEDULE_KICK_AHEAD_MS = 6_000;

function startScheduleSweep(): void {
  if (_sweepInterval !== null) return;
  _sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const sid of _scheduleSids) {
      const list = _reminders.get(sid) ?? [];
      let shouldKick = false;
      for (const r of list) {
        if (
          r.trigger !== "schedule" ||
          r.disabled ||
          r.next_fire_ms === undefined ||
          r.next_fire_ms - now > SCHEDULE_KICK_AHEAD_MS
        ) continue;
        // Dedup: only kick once per unique next_fire_ms value per reminder
        let kickMap = _lastKickedFireMs.get(sid);
        if (!kickMap) { kickMap = new Map<string, number>(); _lastKickedFireMs.set(sid, kickMap); }
        if (kickMap.get(r.id) === r.next_fire_ms) continue;
        kickMap.set(r.id, r.next_fire_ms);
        shouldKick = true;
      }
      if (shouldKick) kickSseSubscriber(sid);
    }
  }, SCHEDULE_SWEEP_INTERVAL_MS);
}

function stopScheduleSweep(): void {
  if (_scheduleSids.size > 0) return;
  if (_sweepInterval !== null) {
    clearInterval(_sweepInterval);
    _sweepInterval = null;
  }
}

// ── Timezone / cron utilities ─────────────────────────────────────────────

const TIMEZONE_ALIASES: Record<string, string> = {
  // DST-aware mappings — abbreviation always resolves to the IANA zone
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",   // DST-aware; MDT handled by same zone
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "Etc/GMT",
};

/** Resolve a TZ abbreviation to its IANA name, or return the input unchanged. */
export function resolveIana(tz: string): string {
  const envTz = process.env.TZ;
  if (envTz && tz === envTz && tz in TIMEZONE_ALIASES) return TIMEZONE_ALIASES[tz];
  return TIMEZONE_ALIASES[tz] ?? tz;
}

/** Validate a resolved IANA timezone by attempting to create a formatter. */
export function validateIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format `date` as an offset-ISO string in the given IANA timezone.
 * Result: "2026-06-10T01:00:00-04:00". Never emits UTC "Z" suffix (§T-6).
 */
export function toOffsetISO(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  const tzName = get("timeZoneName"); // e.g. "GMT-4", "GMT+5:30", "GMT+0"
  if (hour === "24") hour = "00";
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  let offset = "+00:00";
  if (m) {
    const sign = m[1];
    const h = m[2].padStart(2, "0");
    const min = ((m[3] as string | undefined) ?? "00").padStart(2, "0");
    offset = `${sign}${h}:${min}`;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

/** Per-session timestamp of the most recent confirmed outbound send (epoch ms). */
const _lastSentAt = new Map<number, number>();

/** Per-session per-mode timestamp of the most recent qualifying inbound (epoch ms). */
const _lastReceivedAt = new Map<number, Map<"all" | "operator", number>>();

/** Max reminders per session. */
export const MAX_REMINDERS_PER_SESSION = 20;

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Add a reminder for the current caller's session.
 * Throws if the session already has MAX_REMINDERS_PER_SESSION reminders.
 */
export function addReminder(params: {
  id: string;
  text: string;
  delay_seconds: number;
  recurring: boolean;
  trigger?: "time" | "startup" | "last_sent" | "last_received" | "schedule";
  mode?: "all" | "operator";
  only_if_silent?: boolean;
  // Schedule-specific (runtime-only, NOT serialized to profile)
  cron?: string;
  tz?: string;
  next_fire_ms?: number;
}): Reminder {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  // Replace existing reminder with the same ID (user-friendly for re-adds)
  const existingIdx = list.findIndex(r => r.id === params.id);
  if (existingIdx !== -1) {
    const existingReminder = list[existingIdx];
    list.splice(existingIdx, 1);
    // G-A: clean up sweep state if a schedule reminder is replaced by a non-schedule one
    if (existingReminder.trigger === "schedule" && params.trigger !== "schedule") {
      const hasMoreSchedule = list.some(r => r.trigger === "schedule");
      if (!hasMoreSchedule) {
        _scheduleSids.delete(sid);
        stopScheduleSweep();
      }
    }
  } else if (list.length >= MAX_REMINDERS_PER_SESSION) {
    throw new Error(`Max reminders per session (${MAX_REMINDERS_PER_SESSION}) reached`);
  }
  const now = Date.now();
  const trigger = params.trigger ?? "time";
  const normalizedDelay = (trigger === "startup" || trigger === "schedule") ? 0 : params.delay_seconds;
  let state: Reminder["state"];
  let activated_at: number | null;
  if (trigger === "schedule") {
    state = "schedule";
    activated_at = null;
  } else if (trigger === "startup") {
    state = "startup";
    activated_at = null;
  } else if (trigger === "last_sent" || trigger === "last_received") {
    state = "event_pending";
    activated_at = null;
  } else {
    const isActive = normalizedDelay === 0;
    state = isActive ? "active" : "deferred";
    activated_at = isActive ? now : null;
  }
  const reminder: Reminder = {
    id: params.id,
    text: params.text,
    delay_seconds: normalizedDelay,
    recurring: params.recurring,
    trigger,
    ...(trigger === "last_received" ? { mode: params.mode ?? "all" } : {}),
    ...(trigger === "last_received" && params.only_if_silent ? { only_if_silent: true } : {}),
    ...(trigger === "schedule" ? {
      cron: params.cron,
      ...(params.tz !== undefined ? { tz: params.tz } : {}),
      next_fire_ms: params.next_fire_ms,
    } : {}),
    created_at: now,
    activated_at,
    state,
  };
  list.push(reminder);
  _reminders.set(sid, list);
  return reminder;
}

/**
 * Cancel a reminder by ID for the current caller's session.
 * Returns true if found and removed, false if not found.
 */
export function cancelReminder(id: string): boolean {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) return false;
  const removed = list[idx];
  list.splice(idx, 1);
  // G-A: clean up sweep state when a schedule reminder is cancelled
  if (removed.trigger === "schedule") {
    const hasMoreSchedule = list.some(r => r.trigger === "schedule");
    if (!hasMoreSchedule) {
      _scheduleSids.delete(sid);
      stopScheduleSweep();
    }
  }
  return true;
}

/**
 * Disable a reminder (persisted flag). Idempotent.
 * Returns the reminder if found, null if not found.
 */
export function disableReminder(id: string): Reminder | null {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  const r = list.find(r => r.id === id);
  if (!r) return null;
  r.disabled = true;
  return r;
}

/**
 * Enable a previously disabled reminder. Idempotent.
 * Returns the reminder if found, null if not found.
 */
export function enableReminder(id: string): Reminder | null {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  const r = list.find(r => r.id === id);
  if (!r) return null;
  r.disabled = false;
  return r;
}

/**
 * Sleep a reminder until `until` (epoch ms). Transient — not persisted.
 * Pass a past datetime to wake early.
 * Returns the reminder if found, null if not found.
 */
export function sleepReminder(id: string, until: number): Reminder | null {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  const r = list.find(r => r.id === id);
  if (!r) return null;
  r.sleep_until = until;
  return r;
}

// ── Queries ────────────────────────────────────────────────────────────────

/** Return all reminders (deferred + active + startup) for the current caller's session. */
export function listReminders(): Reminder[] {
  return _reminders.get(getCallerSid()) ?? [];
}

/** Return all active reminders for a specific SID (used by dequeue handler). */
export function getActiveReminders(sid: number): Reminder[] {
  const now = Date.now();
  return (_reminders.get(sid) ?? []).filter(r =>
    r.trigger !== "schedule" &&   // §G-3: schedule reminders are never fired by the idle path
    r.state === "active" &&
    !r.disabled &&
    !(r.sleep_until !== undefined && now < r.sleep_until),
  );
}

/** Return all startup reminders for a specific SID. */
export function getStartupReminders(sid: number): Reminder[] {
  return (_reminders.get(sid) ?? []).filter(r => r.state === "startup");
}

/**
 * Return all startup reminders for `sid` that are currently fireable
 * (not disabled, not sleeping past now).
 */
export function getFireableStartupReminders(sid: number): Reminder[] {
  const now = Date.now();
  return (_reminders.get(sid) ?? []).filter(r =>
    r.state === "startup" &&
    !r.disabled &&
    !(r.sleep_until !== undefined && now < r.sleep_until),
  );
}

/**
 * Milliseconds until the soonest deferred reminder for `sid` becomes active.
 * Returns null if there are no deferred reminders.
 */
export function getSoonestDeferredMs(sid: number): number | null {
  const list = _reminders.get(sid) ?? [];
  // §G-3: exclude schedule reminders; they have no delay-based activation
  const deferred = list.filter(r => r.trigger !== "schedule" && r.state === "deferred");
  if (deferred.length === 0) return null;
  const now = Date.now();
  const times = deferred.map(r => r.created_at + r.delay_seconds * 1000 - now);
  return Math.max(0, Math.min(...times));
}

// ── Side-effects ───────────────────────────────────────────────────────────

/**
 * Promote any deferred reminders for `sid` whose delay has elapsed.
 * Call this at the start of each dequeue iteration.
 */
export function promoteDeferred(sid: number): void {
  const list = _reminders.get(sid);
  if (!list) return;
  const now = Date.now();
  for (const r of list) {
    // §G-3: schedule reminders never enter the deferred→active path
    if (r.trigger !== "schedule" && r.state === "deferred" && now >= r.created_at + r.delay_seconds * 1000) {
      r.state = "active";
      r.activated_at = now;
    }
  }
}

/**
 * Remove and return all active reminders for `sid` that are fireable
 * (not disabled, not sleeping past now).
 * One-shot reminders are deleted; recurring ones are re-armed.
 */
export function popActiveReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const now = Date.now();
  const fireable = list.filter(r =>
    r.trigger !== "schedule" &&   // §G-3: schedule reminders fired only by popFireableScheduleReminders
    r.state === "active" &&
    !r.disabled &&
    !(r.sleep_until !== undefined && now < r.sleep_until),
  );
  if (fireable.length === 0) return [];

  const fireableIds = new Set(fireable.map(r => r.id));
  const remaining: Reminder[] = [];
  for (const r of list) {
    if (fireableIds.has(r.id)) {
      if (r.recurring) {
        // Re-arm: go back to deferred if delay > 0, else stay active with refreshed activated_at
        // clear sleep_until (sleep is one-shot per fire cycle)
        remaining.push({
          ...r,
          state: r.delay_seconds > 0 ? "deferred" : "active",
          created_at: now,
          activated_at: r.delay_seconds > 0 ? null : now,
          sleep_until: undefined,
        });
      }
      // one-shot: discarded
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return fireable;
}

/**
 * Fire all startup reminders for `sid` that are fireable (not disabled, not sleeping).
 * Returns the `Reminder[]` that were fired (callers convert them to events via `buildReminderEvent`).
 * One-shot startup reminders are removed from the list; recurring ones remain and will fire again
 * on the next `session_start`.
 */
export function fireStartupReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const now = Date.now();
  const fireable = list.filter(r =>
    r.state === "startup" &&
    !r.disabled &&
    !(r.sleep_until !== undefined && now < r.sleep_until),
  );
  if (fireable.length === 0) return [];

  const fireableIds = new Set(fireable.map(r => r.id));
  const remaining: Reminder[] = [];
  for (const r of list) {
    if (fireableIds.has(r.id)) {
      if (r.recurring) {
        // Recurring startup reminders persist — they fire every session_start
        // Clear sleep_until after firing (sleep is one-shot per fire cycle)
        remaining.push({ ...r, sleep_until: undefined });
      }
      // one-shot: discarded after firing
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return fireable;
}

/**
 * Compute the display state for a reminder (for `reminder/list`).
 * - `"disabled"` — reminder.disabled is true
 * - `"sleeping"` — sleep_until is set and still in the future (returns until ms)
 * - otherwise falls through to the internal state ("active", "deferred", "startup")
 */
export function computeReminderDisplayState(r: Reminder, now: number): { state: string; until?: number } {
  if (r.disabled) return { state: "disabled" };
  if (r.sleep_until !== undefined && now < r.sleep_until) return { state: "sleeping", until: r.sleep_until };
  return { state: r.state };
}

/** Typed shape of the event object produced by `buildReminderEvent`. */
export interface ReminderEvent {
  id: number;
  event: string;
  from: string;
  content: {
    type: string;
    text: string;
    reminder_id: string;
    recurring: boolean;
    trigger: "time" | "startup" | "last_sent" | "last_received" | "schedule";
  };
  routing: string;
}

/** Build a compact synthetic event object for a fired reminder (used in dequeue response). */
export function buildReminderEvent(r: Reminder): ReminderEvent {
  return {
    id: _nextEventId--,
    event: "reminder",
    from: "system",
    content: {
      type: "reminder",
      text: r.text,
      reminder_id: r.id,
      recurring: r.recurring,
      trigger: r.trigger,
    },
    routing: "ambiguous",
  };
}

/** Clear all reminders for a session (call on session close). */
export function clearSessionReminders(sid: number): void {
  _reminders.delete(sid);
  _lastSentAt.delete(sid);
  _lastReceivedAt.delete(sid);
  _lastKickedFireMs.delete(sid);
  // R-4: remove from schedule sweep; stop sweep if this was the last session
  _scheduleSids.delete(sid);
  stopScheduleSweep();
}

/** For testing only: reset all state. */
export function resetReminderStateForTest(): void {
  _reminders.clear();
  _lastSentAt.clear();
  _lastReceivedAt.clear();
  _lastKickedFireMs.clear();
  _nextEventId = -10_000;
  _scheduleSids.clear();
  if (_sweepInterval !== null) {
    clearInterval(_sweepInterval);
    _sweepInterval = null;
  }
}

// ── Schedule (cron-based) reminder helpers ─────────────────────────────────

/**
 * Create and register a cron-based schedule reminder for the current caller's session.
 * Computes `next_fire_ms` from the cron pattern, arms the shared sweep, and returns the Reminder.
 * Caller must have already validated the cron expression and resolved the IANA timezone.
 */
export function scheduleReminder(params: {
  id: string;
  text: string;
  cron: string;
  tz?: string;
}): Reminder {
  const sid = getCallerSid();
  const cron = new Cron(params.cron, { timezone: params.tz, mode: "5-part" });
  const nextDate = cron.nextRun(new Date());
  if (!nextDate) throw new Error("Cron expression produces no future occurrences");
  const next_fire_ms = nextDate.getTime();
  const reminder = addReminder({
    id: params.id,
    text: params.text,
    delay_seconds: 0,
    recurring: true,
    trigger: "schedule",
    cron: params.cron,
    tz: params.tz,
    next_fire_ms,
  });
  _scheduleSids.add(sid);
  startScheduleSweep();
  return reminder;
}

/**
 * Fire all schedule reminders for `sid` whose `next_fire_ms` has elapsed.
 * Advances `next_fire_ms` to the next cron occurrence (collapses catch-up via while loop).
 * Returns the fired reminders (before advancement) — caller converts via buildReminderEvent.
 */
export function popFireableScheduleReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const now = Date.now();
  const fireable = list.filter(r =>
    r.trigger === "schedule" &&
    !r.disabled &&
    r.next_fire_ms !== undefined &&
    now >= r.next_fire_ms &&
    !(r.sleep_until !== undefined && now < r.sleep_until),
  );
  if (fireable.length === 0) return [];

  const fireableIds = new Set(fireable.map(r => r.id));
  const remaining: Reminder[] = [];
  for (const r of list) {
    if (fireableIds.has(r.id)) {
      // §R-2 catch-up: advance next_fire_ms past now (collapse missed occurrences into one fire)
      if (!r.cron || r.next_fire_ms === undefined) { remaining.push(r); continue; }
      const cron = new Cron(r.cron, { timezone: r.tz, mode: "5-part" });
      let nextMs = r.next_fire_ms;
      while (nextMs <= now) {
        const nextDate = cron.nextRun(new Date(nextMs));
        if (!nextDate) break;
        const candidate = nextDate.getTime();
        if (candidate <= nextMs) break; // guard: cron returned same/past timestamp at exact boundary
        nextMs = candidate;
      }
      // Schedule reminders are always recurring — keep with updated next_fire_ms
      remaining.push({ ...r, next_fire_ms: nextMs, sleep_until: undefined });
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return fireable;
}

/**
 * Milliseconds until the soonest schedule reminder for `sid` will fire.
 * Returns null if no schedule reminders exist for this session.
 * Used by dequeue to wake up exactly at next_fire_ms (§R-6).
 */
export function getSoonestScheduleFireMs(sid: number): number | null {
  const list = _reminders.get(sid) ?? [];
  const now = Date.now();
  let soonest: number | null = null;
  for (const r of list) {
    if (r.trigger !== "schedule" || r.disabled || r.next_fire_ms === undefined) continue;
    if (r.sleep_until !== undefined && now < r.sleep_until) continue;
    const ms = Math.max(0, r.next_fire_ms - now);
    if (soonest === null || ms < soonest) soonest = ms;
  }
  return soonest;
}

// ── Event-triggered reminder timestamps ────────────────────────────────────

/**
 * Record the timestamp of a confirmed outbound send for a session.
 * Only updates on confirmed Telegram delivery (message_id returned).
 */
export function recordLastSentAt(sid: number, timestamp: number): void {
  _lastSentAt.set(sid, timestamp);
}

/**
 * Record the timestamp of a qualifying inbound event for a session.
 * Uses max semantics: only updates when `timestamp` > the stored value.
 * Call once with mode="all" for DMs; call twice (all + operator) for operator messages.
 */
export function recordLastReceivedAt(sid: number, mode: "all" | "operator", timestamp: number): void {
  let modeMap = _lastReceivedAt.get(sid);
  if (!modeMap) {
    modeMap = new Map();
    _lastReceivedAt.set(sid, modeMap);
  }
  const existing = modeMap.get(mode);
  if (existing === undefined || timestamp > existing) {
    modeMap.set(mode, timestamp);
  }
}

/** Return the last confirmed send timestamp for a session, or undefined if no send yet. */
export function getLastSentAt(sid: number): number | undefined {
  return _lastSentAt.get(sid);
}

/** Return the last qualifying inbound timestamp for a session+mode, or undefined if none. */
export function getLastReceivedAt(sid: number, mode: "all" | "operator"): number | undefined {
  return _lastReceivedAt.get(sid)?.get(mode);
}

// ── Event-triggered reminder fire logic ────────────────────────────────────

function isEventReminderFireable(r: Reminder, sid: number, now: number): boolean {
  if (r.trigger !== "last_sent" && r.trigger !== "last_received") return false;
  if (r.state !== "event_pending") return false;
  if (r.disabled) return false;
  if (r.sleep_until !== undefined && now < r.sleep_until) return false;

  if (r.trigger === "last_sent") {
    const lastSentAt = _lastSentAt.get(sid);
    if (lastSentAt === undefined) return false;
    if (lastSentAt === r.last_fired_for) return false;
    return now - lastSentAt >= r.delay_seconds * 1000;
  }

  // last_received
  const mode = r.mode ?? "all";
  const lastReceivedAt = _lastReceivedAt.get(sid)?.get(mode);
  if (lastReceivedAt === undefined) return false;
  if (lastReceivedAt === r.last_fired_for) return false;
  if (now - lastReceivedAt < r.delay_seconds * 1000) return false;

  // only_if_silent: suppress if agent has replied (sent) since last qualifying inbound
  if (r.only_if_silent) {
    const lastSentAt = _lastSentAt.get(sid);
    // undefined lastSentAt → never replied → allow fire
    // lastSentAt >= lastReceivedAt → replied after inbound → suppress
    if (lastSentAt !== undefined && lastSentAt >= lastReceivedAt) return false;
  }

  return true;
}

/** Return all fireable event-triggered reminders for `sid` (non-destructive). */
export function getFireableEventReminders(sid: number): Reminder[] {
  const now = Date.now();
  return (_reminders.get(sid) ?? []).filter(r => isEventReminderFireable(r, sid, now));
}

/**
 * Fire all fireable event-triggered reminders for `sid`.
 * One-shot reminders are deleted; recurring ones stay but record `last_fired_for`
 * so they won't re-fire until a new qualifying event resets the clock.
 */
export function popFireableEventReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const now = Date.now();
  const fireable = list.filter(r => isEventReminderFireable(r, sid, now));
  if (fireable.length === 0) return [];

  const fireableIds = new Set(fireable.map(r => r.id));
  const remaining: Reminder[] = [];
  for (const r of list) {
    if (fireableIds.has(r.id)) {
      if (r.recurring) {
        const lastEventAt = r.trigger === "last_sent"
          ? (_lastSentAt.get(sid) ?? 0)
          : (_lastReceivedAt.get(sid)?.get(r.mode ?? "all") ?? 0);
        remaining.push({ ...r, last_fired_for: lastEventAt, sleep_until: undefined });
      }
      // one-shot: discarded
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return fireable;
}

/**
 * Milliseconds until the soonest event-triggered reminder for `sid` becomes fireable.
 * Returns null if no event-triggered reminders exist or none have a qualifying event yet.
 */
export function getSoonestEventReminderMs(sid: number): number | null {
  const list = _reminders.get(sid) ?? [];
  const now = Date.now();
  let soonest: number | null = null;

  for (const r of list) {
    if (r.trigger !== "last_sent" && r.trigger !== "last_received") continue;
    if (r.disabled) continue;
    if (r.sleep_until !== undefined && now < r.sleep_until) continue;

    let lastEventAt: number | undefined;
    if (r.trigger === "last_sent") {
      lastEventAt = _lastSentAt.get(sid);
    } else {
      lastEventAt = _lastReceivedAt.get(sid)?.get(r.mode ?? "all");
    }
    if (lastEventAt === undefined) continue;
    if (lastEventAt === r.last_fired_for) continue;

    const msUntilFire = Math.max(0, r.delay_seconds * 1000 - (now - lastEventAt));
    if (soonest === null || msUntilFire < soonest) soonest = msUntilFire;
  }

  return soonest;
}
