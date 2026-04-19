/**
 * Characters known to render poorly or as missing glyphs in Telegram.
 * Telegram clients (especially older Android/iOS) struggle with:
 * - Box-drawing characters (U+2500–U+257F)
 * - Block elements (U+2580–U+259F)
 * - Geometric shapes that lack emoji fallbacks (U+25A0–U+25FF subset)
 * - Combining characters that stack badly (U+0300–U+036F)
 * - Certain arrows without emoji support (U+2190–U+21FF subset that aren't emoji)
 * - Miscellaneous Technical (U+2300–U+23FF) — many render as boxes
 * - Various mathematical operators (U+2200–U+22FF)
 */
export const UNRENDERABLE_RANGES: Array<[number, number]> = [
  [0x2500, 0x257F], // Box Drawing
  [0x2580, 0x259F], // Block Elements
  [0x2B00, 0x2BFF], // Miscellaneous Symbols and Arrows
  // Enclosed Alphanumeric Supplement — stop before Regional Indicator Symbols (U+1F1E6–U+1F1FF),
  // which are used as flag emoji pairs (🇺🇸, 🇬🇧, etc.) and render correctly in Telegram.
  [0x1F100, 0x1F1E5], // Enclosed Alphanumeric Supplement (non-emoji subset, excludes Regional Indicators)
];

// Specific codepoints known to be problematic
export const UNRENDERABLE_CHARS = new Set<number>([
  0x2192, // → RIGHTWARDS ARROW (use -> instead)
  0x2190, // ← LEFTWARDS ARROW (use <- instead)
  0x2194, // ↔ LEFT RIGHT ARROW
  0x21D2, // ⇒ RIGHTWARDS DOUBLE ARROW (use => instead)
  0x21D0, // ⇐ LEFTWARDS DOUBLE ARROW
  0x21D4, // ⇔ LEFT RIGHT DOUBLE ARROW
  0x2026, // … HORIZONTAL ELLIPSIS (use ... instead)
  0x2018, // ' LEFT SINGLE QUOTATION MARK
  0x2019, // ' RIGHT SINGLE QUOTATION MARK
  0x201C, // " LEFT DOUBLE QUOTATION MARK
  0x201D, // " RIGHT DOUBLE QUOTATION MARK
]);

/**
 * Scan text for characters that may not render correctly in Telegram.
 * Returns an array of problematic characters found (deduplicated).
 */
export function findUnrenderableChars(text: string): string[] {
  const found = new Set<string>();
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (UNRENDERABLE_CHARS.has(cp)) {
      found.add(char);
      continue;
    }
    for (const [start, end] of UNRENDERABLE_RANGES) {
      if (cp >= start && cp <= end) {
        found.add(char);
        break;
      }
    }
  }
  return [...found];
}
