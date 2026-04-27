/**
 * Jaccard-based hybrid send caption-duplication detector.
 * Fires when caption appears to restate audio content rather than labeling it.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "in", "on", "at",
  "to", "for", "of", "with", "by", "from", "as", "is", "was", "are",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "shall", "must", "can", "need",
  "this", "that", "these", "those", "it", "its", "you", "your", "i", "my",
  "we", "our", "they", "their", "he", "she", "his", "her", "not", "no",
  "so", "than", "then", "there", "here", "when", "where", "who", "what", "how",
  "all", "each", "both", "few", "more", "most", "other", "some", "such", "only",
  "own", "same", "too", "very", "just", "about", "above", "after", "before", "between",
  "into", "through", "up", "out", "over", "under", "again", "further", "once", "any",
  "every", "also",
]);

const RE_NON_WORD = /[^a-z0-9\s]/g;
const RE_WHITESPACE = /\s+/;

/**
 * Tokenizes text into a set of lowercase content words.
 * Word counts reflect unique tokens only (set cardinalities).
 * Single-character tokens and English stopwords are excluded.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(RE_NON_WORD, " ")
      .split(RE_WHITESPACE)
      .filter(w => w.length > 1 && !STOPWORDS.has(w)),
  );
}

export interface DuplicationResult {
  isDuplicate: boolean;
  jaccard: number;
  audioWords: number;
  captionWords: number;
}

/**
 * Returns whether the caption appears to restate the audio content.
 *
 * Gates:
 * - Both audio and caption must have >= 5 content words
 * - Caption must be >= 20% of audio word count (filters out pure topic labels)
 * - Jaccard similarity of content-word sets must be >= 0.7
 */
export function detectCaptionDuplication(
  audio: string,
  caption: string,
): DuplicationResult {
  const audioTokens = tokenize(audio);
  const captionTokens = tokenize(caption);

  const audioWords = audioTokens.size;
  const captionWords = captionTokens.size;

  // Length gate: skip if either side has too few content words
  if (audioWords < 5 || captionWords < 5) {
    return { isDuplicate: false, jaccard: 0, audioWords, captionWords };
  }

  // Length-ratio gate: skip if caption is too short (likely a topic label)
  // or too long (likely providing additional context, not restating)
  if (captionWords / audioWords < 0.2 || captionWords > 3 * audioWords) {
    return { isDuplicate: false, jaccard: 0, audioWords, captionWords };
  }

  // Jaccard similarity
  let intersection = 0;
  for (const word of captionTokens) {
    if (audioTokens.has(word)) intersection++;
  }
  const union = audioWords + captionWords - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  return {
    isDuplicate: jaccard >= 0.7,
    jaccard,
    audioWords,
    captionWords,
  };
}
