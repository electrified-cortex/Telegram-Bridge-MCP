/**
 * Per-session reminder state for the Scheduled Reminders feature.
 *
 * **Three-tier queue:**
 * - `deferred` — has a `delay_seconds` > 0 that has not yet elapsed. Cannot fire yet.
 * - `active`   — delay has elapsed (or was 0). Fires after 60 s of idle within `dequeue_update`.
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
  let state: Reminder["state"];
  let activated_at: number | null;
  if (trigger === "startup") {
    // Startup reminders don't use delay — silently normalize to 0
    params = { ...params, delay_seconds: 0 };
    state = "startup";
    activated_at = null;
  } else {
    const isActive = params.delay_seconds === 0;
    state = isActive ? "active" : "deferred";
    activated_at = isActive ? now : null;
  }
  const reminder: Reminder = {
    id: params.id,
    text: params.text,
    delay_seconds: params.delay_seconds,
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

// ── Queries ────────────────────────────────────────────────────────────────

/** Return all reminders (deferred + active + startup) for the current caller's session. */
export function listReminders(): Reminder[] {
  return _reminders.get(getCallerSid()) ?? [];
}

/** Return all active reminders for a specific SID (used by dequeue handler). */
export function getActiveReminders(sid: number): Reminder[] {
  return (_reminders.get(sid) ?? []).filter(r => r.state === "active");
}

/** Return all startup reminders for a specific SID. */
export function getStartupReminders(sid: number): Reminder[] {
  return (_reminders.get(sid) ?? []).filter(r => r.state === "startup");
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
 * Remove and return all active reminders for `sid`.
 * One-shot reminders are deleted; recurring ones are re-armed.
 */
export function popActiveReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const active = list.filter(r => r.state === "active");
  if (active.length === 0) return [];

  const now = Date.now();
  const remaining: Reminder[] = [];
  for (const r of list) {
    if (r.state === "active") {
      if (r.recurring) {
        // Re-arm: go back to deferred if has a delay, else reset activated_at
        remaining.push({
          ...r,
          state: r.delay_seconds > 0 ? "deferred" : "active",
          created_at: now,
          activated_at: r.delay_seconds > 0 ? null : now,
        });
      }
      // one-shot: discarded
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return active;
}

/**
 * Fire all startup reminders for `sid`.
 * Returns the `Reminder[]` that were fired (callers convert them to events via `buildReminderEvent`).
 * One-shot startup reminders are removed from the list; recurring ones remain and will fire again
 * on the next `session_start`.
 */
export function fireStartupReminders(sid: number): Reminder[] {
  const list = _reminders.get(sid);
  if (!list) return [];
  const startupReminders = list.filter(r => r.state === "startup");
  if (startupReminders.length === 0) return [];

  const remaining: Reminder[] = [];
  for (const r of list) {
    if (r.state === "startup") {
      if (r.recurring) {
        // Recurring startup reminders persist — they fire every session_start
        remaining.push(r);
      }
      // one-shot: discarded after firing
    } else {
      remaining.push(r);
    }
  }
  _reminders.set(sid, remaining);
  return startupReminders;
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
