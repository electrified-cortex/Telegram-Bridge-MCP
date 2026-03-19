const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

/** Returns true if the string contains at least one emoji/pictographic symbol. */
export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}

export interface ParityResult {
  ok: boolean;
  withEmoji: string[];
  withoutEmoji: string[];
}

/**
 * Checks that button labels are consistent: either ALL have emoji or NONE do.
 * Returns ok=true when the set is uniform (all-emoji or all-plain).
 */
export function validateButtonSymbolParity(labels: string[]): ParityResult {
  const withEmoji = labels.filter((l) => hasEmoji(l));
  const withoutEmoji = labels.filter((l) => !hasEmoji(l));
  const ok = withEmoji.length === 0 || withoutEmoji.length === 0;
  return { ok, withEmoji, withoutEmoji };
}
