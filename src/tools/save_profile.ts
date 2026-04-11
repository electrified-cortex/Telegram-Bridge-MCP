import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { writeProfile, resolveProfilePath } from "../profile-store.js";
import { getSessionVoiceFor, getSessionSpeedFor } from "../voice-state.js";
import { hasSessionDefault, getDefaultFrames, listPresets, getPreset } from "../animation-state.js";
import { listReminders } from "../reminder-state.js";

const DESCRIPTION =
  "Snapshot the current session's voice, animation, and reminder configuration " +
  "to a profile file for later restoration via load_profile. " +
  "Saves to data/profiles/{key}.json (gitignored). Use load_profile with a path key to load from a checked-in profile.";

export function handleSaveProfile({ key, token }: { key: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  if (key.includes("/") || key.includes("\\")) {
    return toError({ code: "INVALID_KEY", message: "Path keys are not allowed in action(type: 'profile/save', ...). Use a bare key (e.g. \"Overseer\")." });
  }

  const sections: string[] = [];

  const voice = getSessionVoiceFor(_sid);
  const speed = getSessionSpeedFor(_sid);
  const animationDefault = getDefaultFrames(_sid);
  const presetNames = listPresets(_sid);
  const reminders = listReminders();

  const data: Record<string, unknown> = {};

  if (voice !== null) {
    data.voice = voice;
    sections.push("voice");
  }

  if (speed !== null) {
    data.voice_speed = speed;
    sections.push("voice_speed");
  }

  // Only save animation_default when the session has a custom default (not the built-in)
  if (hasSessionDefault(_sid)) {
    data.animation_default = [...animationDefault];
    sections.push("animation_default");
  }

  if (presetNames.length > 0) {
    const presets: Record<string, string[]> = {};
    for (const name of presetNames) {
      const frames = getPreset(_sid, name);
      if (frames) presets[name] = [...frames];
    }
    data.animation_presets = presets;
    sections.push("animation_presets");
  }

  if (reminders.length > 0) {
    data.reminders = reminders.map(r => ({
      text: r.text,
      ...(r.trigger !== "startup" ? { delay_seconds: r.delay_seconds } : {}),
      recurring: r.recurring,
      ...(r.trigger !== "time" ? { trigger: r.trigger } : {}),
    }));
    sections.push("reminders");
  }

  let path: string;
  try {
    path = resolveProfilePath(key);
    writeProfile(key, data);
  } catch (err) {
    return toError({ code: "WRITE_FAILED", message: `Failed to write profile "${key}": ${(err as Error).message}. Check that the profiles directory is writable.` });
  }

  return toResult({ saved: true, key, path, sections });
}

export function register(server: McpServer) {
  server.registerTool(
    "save_profile",
    {
      description: DESCRIPTION,
      inputSchema: {
        key: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Profile key. Must be a bare name (e.g. \"Overseer\"). Saves to data/profiles/{key}.json (gitignored).",
          ),
        token: TOKEN_SCHEMA,
      },
    },
    handleSaveProfile,
  );
}
