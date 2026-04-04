import type { ProfileData } from "../profile-store.js";
import { setSessionVoice, setSessionSpeed } from "../voice-state.js";
import { setSessionDefault, registerPreset } from "../animation-state.js";
import { addReminder, listReminders, reminderContentHash } from "../reminder-state.js";

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
        const reminderId = reminderContentHash(r.text, r.recurring);
        const alreadyExists = existing.some(e => e.id === reminderId);
        const reminder = addReminder({
          id: reminderId,
          text: r.text,
          delay_seconds: r.delay_seconds,
          recurring: r.recurring,
          trigger: r.trigger,
        });
        if (alreadyExists) {
          updatedReminders.push(reminder.id);
        } else {
          addedReminders.push(reminder.id);
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
