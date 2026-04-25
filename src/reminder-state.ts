/**
 * Per-session reminder state for the Scheduled Reminders feature.
 *
 * **Three-tier queue:**
 * - `deferred` — has a `delay_seconds` > 0 that has not yet elapsed. Cannot fire yet.
 * - `active`   — delay has elapsed (or was 0). Fires after 60 s of idle within `dequeue`.
 * - `startup`  — fires on the next `session_start` (including reconnects), not on a timer.
 *
 * Reminders are keyed by SID (per-session, all in-memory).
 */

import { createHash } from "crypto";
import { getCallerSid } from "./session-context.js";

/**
 * Deterministic reminder ID derived from content.
 * Same text+recurring+trigger always yields the same 16-char hex string.
 * Different `recurring` flag or `trigger` → different hash (they coexist).
 */
export function reminderContentHash(text: string, recurring: boolean, trigger: "time" | "startup" = "time"): string {
  return createHash("sha256")
    .update(`${text}\0${recurring}\0${trigger}`)
    .digest("hex")
    .slice(0, 16);
}

export interface Reminder {
  id: string;
  text: string;
  delay_seconds: number;
  recurring: boolean;
  trigger: "time" | "startup";
  created_at: number;      // Date.now() when added
  activated_at: number | null; // Date.now() when promoted to active (null if still deferred/startup)
  state: "deferred" | "active" | "startup";
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
}

const _reminders = new Map<number, Reminder[]>();
let _nextEventId = -10_000;

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
  trigger?: "time" | "startup";
}): Reminder {
  const sid = getCallerSid();
  const list = _reminders.get(sid) ?? [];
  // Replace existing reminder with the same ID (user-friendly for re-adds)
  const existingIdx = list.findIndex(r => r.id === params.id);
  if (existingIdx !== -1) {
    list.splice(existingIdx, 1);
  } else if (list.length >= MAX_REMINDERS_PER_SESSION) {
    throw new Error(`Max reminders per session (${MAX_REMINDERS_PER_SESSION}) reached`);
  }
  const now = Date.now();
  const trigger = params.trigger ?? "time";
  const normalizedDelay = trigger === "startup" ? 0 : params.delay_seconds;
  let state: Reminder["state"];
  let activated_at: number | null;
  if (trigger === "startup") {
    state = "startup";
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
  list.splice(idx, 1);
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
  const deferred = list.filter(r => r.state === "deferred");
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
    if (r.state === "deferred" && now >= r.created_at + r.delay_seconds * 1000) {
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
    trigger: "time" | "startup";
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
}

/** For testing only: reset all state. */
export function resetReminderStateForTest(): void {
  _reminders.clear();
  _nextEventId = -10_000;
}
