import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { cancelReminder, listReminders } from "../../reminder-state.js";

export function handleReminderUnschedule({ token, id }: { token: number; id: string }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  // FIX 3: explicit ownership check — verify the reminder belongs to this session
  // before canceling, preventing any cross-session IDOR if cancelReminder internals change.
  const owned = listReminders().some(r => r.id === id);
  if (!owned) {
    return toError({
      code: "NOT_FOUND" as const,
      message: `No reminder with id="${id}" found for this session. Call action(type: 'reminder/list') to see active reminder IDs.`,
    });
  }

  cancelReminder(id);
  return toResult({ ok: true });
}
