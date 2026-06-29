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

  // BK-1: Guard against undefined/empty values that may slip past optional schema validation.
  if (!word || !replacement) {
    return toError({ code: "INVALID_INPUT" as const, message: "word and replacement are required." });
  }

  const session = getSession(_sid);
  if (!session) return toError({ code: "SESSION_NOT_FOUND" as const, message: "Session not found." });

  if (!session.audio_remapping) session.audio_remapping = {};

  // BK-3: Case-insensitive key normalization.
  const normalizedWord = word.toLowerCase();

  // Case 1: exact key already stored (covers verbatim / case-sensitive exception entries).
  if (word in session.audio_remapping) {
    const previous = session.audio_remapping[word];
    session.audio_remapping[word] = replacement;
    return toResult({ word, replacement, previous, set: true });
  }

  // Case 2: normalized key exists.
  if (normalizedWord in session.audio_remapping) {
    const existingReplacement = session.audio_remapping[normalizedWord];
    if (word === normalizedWord || existingReplacement === replacement) {
      // Same phonetics, or word is already lowercase → update normalized key in place.
      const previous = existingReplacement;
      session.audio_remapping[normalizedWord] = replacement;
      return toResult({ word: normalizedWord, replacement, previous, set: true });
    }
    // Different casing AND different phonetics → case-sensitive exception entry.
    session.audio_remapping[word] = replacement;
    return toResult({ word, replacement, previous: null, set: true });
  }

  // Case 3: no existing entry → store as lowercase.
  session.audio_remapping[normalizedWord] = replacement;
  return toResult({ word: normalizedWord, replacement, previous: null, set: true });
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

  // BK-3: Resolve key case-insensitively (verbatim first, then normalized).
  const map = session.audio_remapping;
  const normalizedWord = word.toLowerCase();
  const effectiveKey =
    map && word in map ? word :
    map && normalizedWord in map ? normalizedWord :
    null;

  if (!effectiveKey || !map) {
    return toError({ code: "NOT_FOUND" as const, message: `No audio remapping entry for "${word}".` });
  }

  const previous = map[effectiveKey];
  // Rebuild the map without the removed key (avoids no-dynamic-delete lint rule).
  const { [effectiveKey]: _removed, ...rest } = map;
  session.audio_remapping = Object.keys(rest).length > 0 ? rest : undefined;

  return toResult({ word: effectiveKey, previous, removed: true });
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
