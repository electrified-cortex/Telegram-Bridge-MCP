/**
 * Phonetic substitution for TTS audio text.
 *
 * Applies a per-profile key→replacement map to audio text before it reaches
 * TTS synthesis, allowing mispronounced names to be phonetically rewritten
 * without affecting captions or the visible message text.
 *
 * Rules:
 *   - Keys are matched case-insensitively (regex "gi" flag).
 *   - Replacement strings are used verbatim (no special `$` interpretation).
 *   - Longer keys win on overlap (keys sorted descending by length).
 *   - Empty or absent map is a no-op; input is returned unchanged.
 *   - Single-pass matching: replacements are never re-processed by other keys.
 *   - Each matched substitution is logged at debug level.
 */

import { dlog } from "./debug-log.js";

/**
 * Apply the phonetic substitution map to `text`.
 *
 * Uses a single-pass multi-key regex so that:
 *  - Longer keys always win over shorter overlapping keys (sorted alternation).
 *  - Replacement text is never re-processed by subsequent keys (no double-sub).
 *
 * @param text - The TTS-stripped audio text to transform.
 * @param map  - Key→replacement dictionary from the session profile.
 *               Keys are treated as literal strings (not regexes), matched
 *               case-insensitively. Longer keys take priority on overlap.
 * @returns The transformed text, or the original `text` if the map is empty
 *          or undefined.
 */
export function applyPhoneticRemapping(
  text: string,
  map: Record<string, string> | undefined,
): string {
  if (!map) return text;

  // Filter out empty-string keys before building the regex — an empty-string
  // key produces new RegExp("", "gi") which matches every position and explodes
  // the output.  Callers should never pass empty keys, but we guard defensively.
  // Sort descending by key length so that longer alternatives appear first in
  // the regex alternation.  JavaScript regex engines pick the first alternative
  // that matches at a given position, so longer keys always beat shorter ones.
  const entries = Object.entries(map)
    .filter(([k]) => k.length > 0)
    .sort(([a], [b]) => b.length - a.length);

  if (entries.length === 0) return text;

  // Build a single alternation regex from all keys (each escaped for literals).
  // A single-pass replacement means no key ever matches inside a replacement
  // string — eliminating the double-substitution problem entirely.
  const pattern = entries
    .map(([key]) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(pattern, "gi");

  // Pre-build a lowercase → { originalKey, replacement } lookup for O(1)
  // case-insensitive retrieval inside the replace callback.
  const lookup = new Map(
    entries.map(([k, v]) => [k.toLowerCase(), { original: k, replacement: v }]),
  );

  return text.replace(regex, (match) => {
    const entry = lookup.get(match.toLowerCase());
    if (entry) {
      // Use a function replacement (not a pattern string) so `$`-sequences in
      // the replacement value are never interpreted as regex back-references.
      dlog("phonetic-remapping", `'${entry.original}' → '${entry.replacement}'`);
      return entry.replacement;
    }
    // Fallback — should not occur in practice since the regex was built from
    // the same keys, but keeps TypeScript and future refactors safe.
    return match;
  });
}
