import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { cancelReminder } from "../../reminder-state.js";

export function handleReminderUnschedule({ token, id }: { token: number; id: string }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const cancelled = cancelReminder(id);
  if (!cancelled) {
    return toError({
      code: "NOT_FOUND" as const,
      message: `No reminder with id="${id}" found for this session. Call action(type: 'reminder/list') to see active reminder IDs.`,
    });
  }
  return toResult({ ok: true });
}
