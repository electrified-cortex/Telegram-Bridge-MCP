import type { ProfileData } from "../profile-store.js";
import { setSessionVoice, setSessionSpeed } from "../voice-state.js";
import { setSessionDefault, registerPreset } from "../animation-state.js";
import { addReminder, listReminders, reminderContentHash } from "../reminder-state.js";
import { setTutorialEnabled } from "../session-manager.js";

export interface ApplyResult {
  applied: Record<string, unknown>;
}

export interface ApplyError {
  code: string;
  message: string;
}

export function applyProfile(sid: number, profile: ProfileData): ApplyResult | ApplyError {
  const applied: Record<string, unknown> = {};

  try {
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
        // Normalize undefined trigger to "time"
        const trigger = r.trigger ?? "time";
        if (trigger === "startup") {
          // Startup reminder — delay_seconds not required
          const reminderId = reminderContentHash(r.text, r.recurring, "startup");
          const alreadyExists = existing.some(e => e.id === reminderId);
          const added = addReminder({
            id: reminderId,
            text: r.text,
            recurring: r.recurring,
            trigger: "startup",
            delay_seconds: r.delay_seconds ?? 0,
          });
          if (alreadyExists) {
            updatedReminders.push(added.id);
          } else {
            addedReminders.push(added.id);
          }
        } else {
          // Time reminder — delay_seconds is required; skip if missing/invalid
          if (typeof r.delay_seconds !== "number" || isNaN(r.delay_seconds)) continue;
          const reminderId = reminderContentHash(r.text, r.recurring, "time");
          const alreadyExists = existing.some(e => e.id === reminderId);
          const added = addReminder({
            id: reminderId,
            text: r.text,
            recurring: r.recurring,
            trigger: "time",
            delay_seconds: r.delay_seconds,
          });
          if (alreadyExists) {
            updatedReminders.push(added.id);
          } else {
            addedReminders.push(added.id);
          }
        }
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

    if (profile.tutorial !== undefined) {
      setTutorialEnabled(sid, profile.tutorial);
      applied.tutorial = profile.tutorial;
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
}
