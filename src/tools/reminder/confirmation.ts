/**
 * Reminder confirmation service message — emitted after every successful
 * reminder/set or reminder/schedule call.
 *
 * Tier classification:
 *   Tier 1 (≤15 min interval): minimal confirm, no timestamp
 *   Tier 2 (hourly/daily, ≤7 days): confirm + next_fire ISO-8601 timestamp
 *   Tier 3 (weekly+, gap >7 days, annual-pinned): confirm + WARNING + suggestion
 */

import { Cron } from "croner";
import type { Reminder } from "../../reminder-state.js";
import { deliverServiceMessage } from "../../session-queue.js";

// ── Tier thresholds ─────────────────────────────────────────────────────────

const TIER1_MAX_MS = 15 * 60 * 1_000;          // 15 minutes
const TIER3_MIN_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ── Tier classification ─────────────────────────────────────────────────────

type Tier = 1 | 2 | 3;

/**
 * Classify a reminder into Tier 1, 2, or 3 based on its firing interval/gap.
 * Exported for unit testing.
 *
 * @param now  Current epoch ms (injectable for tests).
 */
export function classifyReminderTier(reminder: Reminder, now: number = Date.now()): Tier {
  if (reminder.trigger === "schedule") {
    return _classifyScheduleTier(reminder, now);
  }
  // startup is event-based; classify as Tier 2 (fires on session start — unpredictable timing)
  if (reminder.trigger === "startup") return 2;
  // For time / last_sent / last_received: use delay_seconds as the interval proxy
  const delayMs = reminder.delay_seconds * 1_000;
  if (delayMs <= TIER1_MAX_MS) return 1;
  if (delayMs < TIER3_MIN_MS) return 2;
  return 3;
}

function _classifyScheduleTier(reminder: Reminder, now: number): Tier {
  if (!reminder.cron || reminder.next_fire_ms === undefined) return 2;

  const gapMs = reminder.next_fire_ms - now;

  // Compute interval between first and second fire
  let intervalMs: number;
  try {
    const cron = new Cron(reminder.cron, { timezone: reminder.tz, mode: "5-part" });
    const secondDate = cron.nextRun(new Date(reminder.next_fire_ms));
    intervalMs = secondDate ? secondDate.getTime() - reminder.next_fire_ms : gapMs;
  } catch {
    // Fallback: classify by gap alone if cron can't be re-parsed
    return gapMs > TIER3_MIN_MS ? 3 : 2;
  }

  // Either the gap to next fire OR the recurrence interval exceeds 7 days → Tier 3
  if (gapMs > TIER3_MIN_MS || intervalMs > TIER3_MIN_MS) return 3;
  // Interval ≤ 15 min AND next fire is also within 15 min → Tier 1
  if (intervalMs <= TIER1_MAX_MS && gapMs <= TIER1_MAX_MS) return 1;
  return 2;
}

// ── next_fire computation ───────────────────────────────────────────────────

function _computeNextFire(reminder: Reminder, tier: Tier, now: number): string | null {
  // Tier 1: high-frequency — no timestamp needed
  if (tier === 1) return null;

  if (reminder.trigger === "schedule" && reminder.next_fire_ms !== undefined) {
    return new Date(reminder.next_fire_ms).toISOString();
  }

  if (reminder.trigger === "time") {
    return new Date(now + reminder.delay_seconds * 1_000).toISOString();
  }

  // startup / last_sent / last_received: event-based — fire time is unknown
  return null;
}

// ── Human-readable helpers ──────────────────────────────────────────────────

function _formatDelay(delaySeconds: number): string {
  if (delaySeconds < 60) return `${delaySeconds}s`;
  if (delaySeconds < 3_600) return `${Math.round(delaySeconds / 60)} min`;
  if (delaySeconds < 86_400) return `${Math.round(delaySeconds / 3_600)} hr`;
  return `${Math.round(delaySeconds / 86_400)} day(s)`;
}

function _buildFrequencyLabel(reminder: Reminder): string {
  if (reminder.trigger === "schedule") return `cron \`${reminder.cron}\` (tz: ${reminder.tz ?? "UTC"})`;
  if (reminder.trigger === "startup") return "on session start";
  if (reminder.trigger === "last_sent") return `${_formatDelay(reminder.delay_seconds)} after last outbound send`;
  if (reminder.trigger === "last_received") return `${_formatDelay(reminder.delay_seconds)} after last inbound`;
  // time trigger
  return _formatDelay(reminder.delay_seconds);
}

function _buildPlainSummary(
  reminder: Reminder,
  tier: Tier,
  nextFire: string | null,
): string {
  const recurring = reminder.recurring || reminder.trigger === "schedule";
  const freqLabel = _buildFrequencyLabel(reminder);

  if (tier === 1) {
    return `Reminder set: fires every ${freqLabel}${recurring ? " (recurring)" : ""}.`;
  }

  if (tier === 2) {
    const nextStr = nextFire ? ` Next: ${nextFire}.` : "";
    if (reminder.trigger === "startup") {
      return `Reminder set: fires on next session start${recurring ? " (recurring)" : ""}.`;
    }
    return `Reminder set: fires ${freqLabel}${recurring ? " (recurring)" : ""}.${nextStr}`;
  }

  // Tier 3
  const nextStr = nextFire ? `fires ${nextFire}` : "fires far in the future";
  return (
    `⚠️ Reminder set: ${nextStr}${recurring ? " (recurring)" : ""}. ` +
    `Session survival until fire is unlikely. ` +
    `Cancel: \`reminder/cancel ${reminder.id}\`.`
  );
}

function _buildTierWarning(
  reminder: Reminder,
  tier: Tier,
  nextFire: string | null,
): string | null {
  if (tier !== 3) return null;
  const recurring = reminder.recurring || reminder.trigger === "schedule";
  const nextStr = nextFire ? `fires ${nextFire}` : "fires far in the future";
  let warning = `⚠️ This reminder ${nextStr}.`;
  if (recurring) {
    warning +=
      " This is a recurring reminder with a long interval or far-future fire time. " +
      "The likelihood of this session surviving to fire is very low. " +
      "Consider a one-shot alternative, or save to profile for persistence.";
  }
  warning += ` Cancel with: \`reminder/cancel ${reminder.id}\``;
  return warning;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function _buildPersistenceNote(recurring: boolean): string {
  if (recurring) {
    return "Recurring but NOT saved to profile — will not survive session restart. To persist: `profile/save`.";
  }
  return "Will fire once then expire. Not saved to profile.";
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deliver a `reminder_confirmation` service message to `sid` after a
 * successful `reminder/set` or `reminder/schedule` call.
 *
 * Always emits to the session queue synchronously — the tool response body
 * is unchanged (AC6).
 */
export function deliverReminderConfirmation(sid: number, reminder: Reminder): void {
  const now = Date.now();
  const tier = classifyReminderTier(reminder, now);
  const nextFire = _computeNextFire(reminder, tier, now);
  const recurring = reminder.recurring || reminder.trigger === "schedule";
  const persistence = "session_only" as const;
  const persistenceNote = _buildPersistenceNote(recurring);
  const plainSummary = _buildPlainSummary(reminder, tier, nextFire);
  const tierWarning = _buildTierWarning(reminder, tier, nextFire);

  deliverServiceMessage(sid, plainSummary, "reminder_confirmation", {
    reminder_id: reminder.id,
    next_fire: nextFire,
    persistence,
    persistence_note: persistenceNote,
    tier,
    tier_warning: tierWarning,
  });
}
