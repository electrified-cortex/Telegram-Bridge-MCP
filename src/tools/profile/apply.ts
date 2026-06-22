import type { ProfileData } from "../../profile-store.js";
import { setSessionVoice, setSessionSpeed } from "../../voice-state.js";
import { setSessionDefault, registerPreset } from "../../animation-state.js";
import { addReminder, disableReminder, enableReminder, listReminders, reminderContentHash, scheduleReminder, resolveIana, validateIana } from "../../reminder-state.js";
import { getSession } from "../../session-manager.js";
import { runInSessionContext } from "../../session-context.js";

export interface ApplyResult {
  applied: Record<string, unknown>;
}

export interface ApplyError {
  code: string;
  message: string;
}

export function applyProfile(sid: number, profile: ProfileData): ApplyResult | ApplyError {
  return runInSessionContext(sid, () => {
  const applied: Record<string, unknown> = {};

  try {
    // Support legacy `nametag_emoji` field from profiles saved before v7.4
    const nameTagValue =
      profile.name_tag ?? (profile as Record<string, unknown>)["nametag_emoji"] as string | undefined;
    if (nameTagValue !== undefined) {
      const session = getSession(sid);
      if (session) {
        session.name_tag = nameTagValue;
        applied.name_tag = nameTagValue;
      }
    }

    if (profile.voice !== undefined) {
      setSessionVoice(profile.voice);
      applied.voice = profile.voice;
    }

    if (profile.voice_speed !== undefined) {
      setSessionSpeed(profile.voice_speed);
      applied.voice_speed = profile.voice_speed;
    }

    if (profile.animation_default !== undefined) {
      setSessionDefault(sid, profile.animation_default);
      applied.animation_default = true;
    }

    const appliedPresets: string[] = [];
    if (profile.animation_presets !== undefined) {
      for (const [name, frames] of Object.entries(profile.animation_presets)) {
        registerPreset(sid, name, frames);
        appliedPresets.push(name);
      }
    }
    if (appliedPresets.length > 0) applied.presets = appliedPresets;

    const addedReminders: string[] = [];
    const updatedReminders: string[] = [];
    if (profile.reminders !== undefined) {
      const existing = listReminders();
      for (const r of profile.reminders) {
        // Normalize undefined trigger to "time". Cast to a flexible type for property access
        // since TypeScript cannot narrow through a derived `trigger` variable on a union type.
        const trigger = r.trigger ?? "time";
        const rd = r as Record<string, unknown>;
        if (trigger === "startup") {
          // Startup reminder — delay_seconds not required
          const recurring = (rd.recurring as boolean | undefined) ?? false;
          const reminderId = reminderContentHash(r.text, recurring, "startup");
          const alreadyExists = existing.some(e => e.id === reminderId);
          const added = addReminder({
            id: reminderId,
            text: r.text,
            recurring,
            trigger: "startup",
            delay_seconds: (rd.delay_seconds as number | undefined) ?? 0,
          });
          // Restore persisted disabled flag (sleep_until is not persisted)
          if (r.disabled) disableReminder(added.id);
          else if (r.disabled === false) enableReminder(added.id);
          if (alreadyExists) {
            updatedReminders.push(added.id);
          } else {
            addedReminders.push(added.id);
          }
        } else if (trigger === "last_sent") {
          const delay_seconds = rd.delay_seconds as number | undefined;
          if (typeof delay_seconds !== "number" || isNaN(delay_seconds)) continue;
          const recurring = (rd.recurring as boolean | undefined) ?? false;
          const reminderId = reminderContentHash(r.text, recurring, "last_sent");
          const alreadyExists = existing.some(e => e.id === reminderId);
          if (!alreadyExists) {
            addReminder({
              id: reminderId,
              text: r.text,
              recurring,
              trigger: "last_sent",
              delay_seconds,
            });
            addedReminders.push(reminderId);
          } else {
            updatedReminders.push(reminderId);
          }
          if (r.disabled) disableReminder(reminderId);
          else if (r.disabled === false) enableReminder(reminderId);
        } else if (trigger === "last_received") {
          const delay_seconds = rd.delay_seconds as number | undefined;
          if (typeof delay_seconds !== "number" || isNaN(delay_seconds)) continue;
          const recurring = (rd.recurring as boolean | undefined) ?? false;
          const mode = (rd.mode as "all" | "operator" | undefined) ?? "all";
          const only_if_silent = rd.only_if_silent as boolean | undefined;
          const reminderId = reminderContentHash(r.text, recurring, "last_received", mode, only_if_silent);
          const alreadyExists = existing.some(e => e.id === reminderId);
          if (!alreadyExists) {
            addReminder({
              id: reminderId,
              text: r.text,
              recurring,
              trigger: "last_received",
              delay_seconds,
              mode,
              only_if_silent,
            });
            addedReminders.push(reminderId);
          } else {
            updatedReminders.push(reminderId);
          }
          if (r.disabled) disableReminder(reminderId);
          else if (r.disabled === false) enableReminder(reminderId);
        } else if (trigger === "schedule") {
          // G-4: schedule branch — use cron+tz, skip delay_seconds/next_fire_ms/timeoutHandle
          const cron = rd.cron as string | undefined;
          const rawTz = rd.tz as string | undefined;
          if (!cron) continue; // cron is required for schedule reminders
          // FIX 2: resolve + validate TZ on the apply path (same as schedule.ts handler)
          const resolvedTz = rawTz !== undefined ? resolveIana(rawTz) : resolveIana(process.env.TZ ?? "UTC");
          if (!validateIana(resolvedTz)) continue; // skip if TZ is invalid
          const reminderId = reminderContentHash(r.text, true, "schedule");
          // dedup guard — check for existing reminder by ID before re-adding
          const alreadyExists = existing.some(e => e.id === reminderId);
          if (alreadyExists) {
            updatedReminders.push(reminderId);
          } else {
            scheduleReminder({ id: reminderId, text: r.text, cron, tz: resolvedTz });
            addedReminders.push(reminderId);
          }
          if (r.disabled) disableReminder(reminderId);
          else if (r.disabled === false) enableReminder(reminderId);
        } else {
          // Time reminder — delay_seconds is required; skip if missing/invalid
          const delay_seconds = rd.delay_seconds as number | undefined;
          if (typeof delay_seconds !== "number" || isNaN(delay_seconds)) continue;
          const recurring = (rd.recurring as boolean | undefined) ?? false;
          const reminderId = reminderContentHash(r.text, recurring, "time");
          const alreadyExists = existing.some(e => e.id === reminderId);
          const added = addReminder({
            id: reminderId,
            text: r.text,
            recurring,
            trigger: "time",
            delay_seconds,
          });
          // Restore persisted disabled flag (sleep_until is not persisted)
          if (r.disabled) disableReminder(added.id);
          else if (r.disabled === false) enableReminder(added.id);
          if (alreadyExists) {
            updatedReminders.push(added.id);
          } else {
            addedReminders.push(added.id);
          }
        }
      }
    }
    if (profile.suppress_pending_hint !== undefined) {
      const session = getSession(sid);
      if (session) {
        session.suppress_pending_hint = profile.suppress_pending_hint;
        applied.suppress_pending_hint = profile.suppress_pending_hint;
      }
    }

    if (profile.silent_lifecycle !== undefined) {
      const session = getSession(sid);
      if (session) {
        session.silent_lifecycle = profile.silent_lifecycle;
        applied.silent_lifecycle = profile.silent_lifecycle;
      }
    }

    if (addedReminders.length > 0 || updatedReminders.length > 0) {
      const reminderSummary: Record<string, unknown> = {
        added: addedReminders,
        updated: updatedReminders,
      };
      if (updatedReminders.length > 0) reminderSummary.review_recommended = true;
      applied.reminders = reminderSummary;
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isReminderLimit = message.includes("Max reminders per session");
    return {
      code: isReminderLimit ? "REMINDER_LIMIT_EXCEEDED" : "APPLY_FAILED",
      message,
    };
  }

  return { applied };
  }); // end runInSessionContext
}
