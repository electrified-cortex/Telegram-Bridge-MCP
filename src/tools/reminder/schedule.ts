import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import {
  reminderContentHash,
  scheduleReminder,
  resolveIana,
  validateIana,
  toOffsetISO,
  listReminders,
  MAX_REMINDERS_PER_SESSION,
} from "../../reminder-state.js";

export function handleScheduleReminder({ token, text, cron, tz = "UTC", id }: {
  token: number;
  text: string;
  cron: string;
  tz?: string;
  id?: string;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  // Validate exactly 5 fields (reject 6-field → INVALID_CRON)
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return toError({
      code: "INVALID_CRON" as const,
      message: `Cron expression must have exactly 5 fields (minute hour day month weekday). Got ${fields.length} field(s): "${cron}"`,
      hint: "Example: \"0 9 * * *\" fires at 9am daily.",
    });
  }

  // Resolve TZ alias (EST → America/New_York, etc.)
  const resolvedTz = resolveIana(tz);

  // Validate resolved IANA timezone
  if (!validateIana(resolvedTz)) {
    return toError({
      code: "INVALID_TIMEZONE" as const,
      message: `Invalid timezone: "${tz}"${resolvedTz !== tz ? ` (resolved to "${resolvedTz}")` : ""}. Use an IANA timezone name (e.g. "America/New_York") or a supported alias (PST, MST, CST, EST, UTC, GMT).`,
    });
  }

  // Check limit (count before adding; allow replacing existing by same ID)
  const existing = listReminders();
  const reminderId = id ?? reminderContentHash(text, true, "schedule");
  const isReplace = existing.some(r => r.id === reminderId);
  if (!isReplace && existing.length >= MAX_REMINDERS_PER_SESSION) {
    return toError({
      code: "LIMIT_EXCEEDED" as const,
      message: `Max reminders per session (${MAX_REMINDERS_PER_SESSION}) reached. Cancel an existing reminder before adding more.`,
    });
  }

  let reminder;
  try {
    reminder = scheduleReminder({ id: reminderId, text, cron, tz: resolvedTz });
  } catch (err) {
    return toError({
      code: "INVALID_CRON" as const,
      message: `Invalid cron expression: ${(err as Error).message}`,
    });
  }

  const nextDate = new Date(reminder.next_fire_ms ?? 0);
  return toResult({
    ok: true,
    id: reminder.id,
    cron: reminder.cron,
    tz: reminder.tz ?? "UTC",
    next_fire: toOffsetISO(nextDate, reminder.tz ?? "UTC"),
  });
}
