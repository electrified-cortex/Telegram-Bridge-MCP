/**
 * Stale-checklist timer state.
 *
 * Tracks one optional `setTimeout` per checklist message_id.
 * When `stale_after_ms` elapses without a `resetStaleTimer` call and the
 * checklist still has non-terminal steps, fires a synthetic reminder event
 * into the owning session's dequeue queue via `deliverChecklistStaleEvent`.
 */

import { deliverChecklistStaleEvent } from "../../session-queue.js";
import type { ChecklistStep } from "./update.js";

interface StaleTimerEntry {
  timer: ReturnType<typeof setTimeout>;
  sid: number;
  stale_after_ms: number;
  title: string;
  steps: ChecklistStep[];
}

const _timers = new Map<number, StaleTimerEntry>();

const TERMINAL_STATUSES = new Set(["done", "failed", "skipped"]);

function isAllTerminal(steps: ChecklistStep[]): boolean {
  return steps.length > 0 && steps.every(s => TERMINAL_STATUSES.has(s.status));
}

function countPending(steps: ChecklistStep[]): number {
  return steps.filter(s => s.status === "pending" || s.status === "running").length;
}

function fireStaleReminder(message_id: number): void {
  const entry = _timers.get(message_id);
  if (!entry) return;
  _timers.delete(message_id);
  if (isAllTerminal(entry.steps)) return; // suppressed — all steps are terminal
  const pending_count = countPending(entry.steps);
  deliverChecklistStaleEvent(
    entry.sid,
    message_id,
    entry.title,
    pending_count,
    Math.round(entry.stale_after_ms / 1000),
  );
}

/**
 * Arm (or replace) a stale timer for a checklist message.
 * If `stale_after_ms` elapses without a reset and steps are still non-terminal,
 * a reminder event is injected into session `sid`'s dequeue queue.
 *
 * @param message_id  Checklist Telegram message ID
 * @param sid         Session ID of the owning session
 * @param stale_after_ms  Milliseconds until reminder fires (from now or last reset)
 * @param title       Checklist title (included in reminder content)
 * @param steps       Current step list (terminal state determines suppression)
 */
export function armStaleTimer(
  message_id: number,
  sid: number,
  stale_after_ms: number,
  title: string,
  steps: ChecklistStep[],
): void {
  clearStaleTimer(message_id); // cancel any existing timer for this message_id
  const timer = setTimeout(() => fireStaleReminder(message_id), stale_after_ms);
  _timers.set(message_id, { timer, sid, stale_after_ms, title, steps });
}

/**
 * Reset the stale timer for a checklist message — call on every `checklist/update`.
 * No-op if `stale_after` was never set for this `message_id`.
 *
 * @param message_id  Checklist Telegram message ID
 * @param title       Updated checklist title
 * @param steps       Updated steps (used for terminal-state suppression at fire time)
 */
export function resetStaleTimer(
  message_id: number,
  title: string,
  steps: ChecklistStep[],
): void {
  const entry = _timers.get(message_id);
  if (!entry) return; // stale_after was never set — nothing to reset
  clearTimeout(entry.timer);
  const timer = setTimeout(() => fireStaleReminder(message_id), entry.stale_after_ms);
  _timers.set(message_id, { ...entry, timer, title, steps });
}

/**
 * Clear and discard the stale timer for a checklist message.
 * Call when all steps reach terminal state so no spurious reminder fires.
 */
export function clearStaleTimer(message_id: number): void {
  const entry = _timers.get(message_id);
  if (!entry) return;
  clearTimeout(entry.timer);
  _timers.delete(message_id);
}

/** @internal Reset all timer state — for unit tests only. */
export function resetStaleTimerStateForTest(): void {
  for (const entry of _timers.values()) {
    clearTimeout(entry.timer);
  }
  _timers.clear();
}
