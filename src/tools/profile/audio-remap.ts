/**
 * Live audio remapping management actions.
 *
 * Allows agents to add, remove, and list phonetic substitution entries in the
 * live session map without editing profile files. Changes take effect immediately
 * for all subsequent TTS sends. Use profile/save to persist the map to a profile.
 *
 * Actions:
 *   profile/audio-remap/set    — add or update a word→replacement entry
 *   profile/audio-remap/remove — remove an entry by word
 *   profile/audio-remap/list   — list all current entries
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";

export function handleAudioRemapSet({
  word,
  replacement,
  token,
}: {
  word: string;
  replacement: string;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const session = getSession(_sid);
  if (!session) return toError({ code: "SESSION_NOT_FOUND" as const, message: "Session not found." });

  if (!session.audio_remapping) session.audio_remapping = {};
  const previous = session.audio_remapping[word] ?? null;
  session.audio_remapping[word] = replacement;

  return toResult({ word, replacement, previous, set: true });
}

export function handleAudioRemapRemove({
  word,
  token,
}: {
  word: string;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const session = getSession(_sid);
  if (!session) return toError({ code: "SESSION_NOT_FOUND" as const, message: "Session not found." });

  if (!session.audio_remapping || !(word in session.audio_remapping)) {
    return toError({ code: "NOT_FOUND" as const, message: `No audio remapping entry for "${word}".` });
  }

  const previous = session.audio_remapping[word];
  delete session.audio_remapping[word];
  if (Object.keys(session.audio_remapping).length === 0) session.audio_remapping = undefined;

  return toResult({ word, previous, removed: true });
}

export function handleAudioRemapList({ token }: { token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const session = getSession(_sid);
  if (!session) return toError({ code: "SESSION_NOT_FOUND" as const, message: "Session not found." });

  const map = session.audio_remapping ?? {};
  const entries = Object.entries(map).map(([word, replacement]) => ({ word, replacement }));

  return toResult({ entries, count: entries.length });
}
