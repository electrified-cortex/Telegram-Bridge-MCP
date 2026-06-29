/**
 * Stale-progress timer state.
 *
 * Tracks one optional `setTimeout` per progress message_id.
 * When `stale_after_ms` elapses without a `resetStaleTimer` call and the
 * progress bar is still below 100%, fires a synthetic reminder event
 * into the owning session's dequeue queue via `deliverProgressStaleEvent`.
 */

import { deliverProgressStaleEvent } from "../../session-queue.js";

interface StaleTimerEntry {
  timer: ReturnType<typeof setTimeout>;
  sid: number;
  stale_after_ms: number;
  title: string;
  percent: number;
}

const _timers = new Map<number, StaleTimerEntry>();

function fireStaleReminder(message_id: number): void {
  const entry = _timers.get(message_id);
  if (!entry) return;
  _timers.delete(message_id);
  if (entry.percent >= 100) return; // suppressed — progress is complete
  deliverProgressStaleEvent(
    entry.sid,
    message_id,
    entry.title,
    entry.percent,
    Math.round(entry.stale_after_ms / 1000),
  );
}

/**
 * Arm (or replace) a stale timer for a progress bar message.
 * If `stale_after_ms` elapses without a reset and percent is still below 100,
 * a reminder event is injected into session `sid`'s dequeue queue.
 *
 * @param message_id       Progress bar Telegram message ID
 * @param sid              Session ID of the owning session
 * @param stale_after_ms   Milliseconds until reminder fires (from now or last reset)
 * @param title            Progress bar title (included in reminder content)
 * @param percent          Current progress percent (suppresses reminder if >= 100 at fire time)
 */
export function armStaleTimer(
  message_id: number,
  sid: number,
  stale_after_ms: number,
  title: string,
  percent: number,
): void {
  clearStaleTimer(message_id); // cancel any existing timer for this message_id
  const timer = setTimeout(() => { fireStaleReminder(message_id); }, stale_after_ms);
  _timers.set(message_id, { timer, sid, stale_after_ms, title, percent });
}

/**
 * Reset the stale timer for a progress bar message — call on every `progress/update`.
 * No-op if `stale_after` was never set for this `message_id`.
 *
 * @param message_id  Progress bar Telegram message ID
 * @param title       Updated title
 * @param percent     Updated percent (used for suppression at fire time)
 */
export function resetStaleTimer(
  message_id: number,
  title: string,
  percent: number,
): void {
  const entry = _timers.get(message_id);
  if (!entry) return; // stale_after was never set — nothing to reset
  clearTimeout(entry.timer);
  const timer = setTimeout(() => { fireStaleReminder(message_id); }, entry.stale_after_ms);
  _timers.set(message_id, { ...entry, timer, title, percent });
}

/**
 * Clear and discard the stale timer for a progress bar message.
 * Call when percent reaches 100 so no spurious reminder fires.
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
