import { describe, it, expect } from "vitest";
import { detectCaptionDuplication } from "./hybrid-duplication-detector.js";

describe("detectCaptionDuplication unit tests", () => {
  // ---------------------------------------------------------------------------
  // Threshold boundary
  // ---------------------------------------------------------------------------

  it("triggers at exactly Jaccard >= 0.7 (identical content words)", () => {
    // Construct audio and caption with known content word overlap.
    // Use 7 shared content words out of 7 unique words total → Jaccard = 7/7 = 1.0
    const audio = "alpha bravo charlie delta echo foxtrot golf";
    const caption = "alpha bravo charlie delta echo foxtrot golf";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(true);
    expect(result.jaccard).toBeGreaterThanOrEqual(0.7);
  });

  it("does not trigger when Jaccard is below 0.7", () => {
    // Build a case where overlap is clearly low.
    // audio: 10 unique content words, caption: 10 unique content words, 0 shared → Jaccard = 0/20 = 0
    const audio = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const caption = "kilo lima mike november oscar papa quebec romeo sierra tango";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBeLessThan(0.7);
  });

  it("below threshold: 7 shared, 3 unique each → 7/13 ≈ 0.538 does not trigger", () => {
    // Build a case where Jaccard is exactly >= 0.7.
    // 7 shared, 0 unique each → Jaccard = 7/7 = 1.0 (already covered above)
    // 7 shared out of 10 total unique: audio has 7 words, caption has 7 words, all same → 7/7 = 1.0
    // For a boundary near 0.7: 7 shared, 3 unique each → 7/(7+3) = 0.7 exactly
    const shared = ["rapid", "brown", "jumping", "swift", "clever", "bright", "tall"];
    const audioOnly = ["forest", "mountain", "river"];
    const captionOnly = ["sunset", "ocean", "cloud"];
    const audio = [...shared, ...audioOnly].join(" ");
    const caption = [...shared, ...captionOnly].join(" ");
    const result = detectCaptionDuplication(audio, caption);
    // jaccard = 7/(7+3+3) = 7/13 ≈ 0.538 — below 0.7; test that boundary is respected
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBeCloseTo(7 / 13, 5);
  });

  it("jaccard >= 0.7 exact: 7 shared words, 0 extra on either side", () => {
    // 7 shared words, nothing unique → Jaccard = 1.0
    const words = "rapid brown jumping swift clever bright tall";
    const result = detectCaptionDuplication(words, words);
    expect(result.isDuplicate).toBe(true);
    expect(result.jaccard).toBeCloseTo(1.0, 5);
  });

  it("jaccard boundary at 0.7: 7 shared, 3 audio-only → 7/10 = 0.7 triggers", () => {
    // audio: 10 content words (7 shared + 3 unique)
    // caption: 7 content words (7 shared, 0 unique)
    // Jaccard = 7 / (10 + 7 - 7) = 7/10 = 0.7 → triggers
    const shared = ["rapid", "brown", "jumping", "swift", "clever", "bright", "tall"];
    const audioOnly = ["forest", "mountain", "river"];
    const audio = [...shared, ...audioOnly].join(" ");
    const caption = shared.join(" ");
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(true);
    expect(result.jaccard).toBeCloseTo(0.7, 5);
  });

  it("just below boundary: 6 shared, 3 audio-only → 6/9 ≈ 0.667 does not trigger", () => {
    // audio: 9 words (6 shared + 3 unique), caption: 6 words (all shared)
    // Jaccard = 6/9 ≈ 0.667 → below 0.7
    const shared = ["rapid", "brown", "jumping", "swift", "clever", "bright"];
    const audioOnly = ["forest", "mountain", "river"];
    const audio = [...shared, ...audioOnly].join(" ");
    const caption = shared.join(" ");
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBeCloseTo(6 / 9, 5);
  });

  // ---------------------------------------------------------------------------
  // Length gate: < 5 content words on either side → no trigger
  // ---------------------------------------------------------------------------

  it("length gate: audio has < 5 content words → no trigger", () => {
    // 4 content words in audio (stopwords are filtered out)
    const audio = "alpha bravo charlie delta";
    const caption = "alpha bravo charlie delta echo foxtrot golf hotel india";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
  });

  it("length gate: caption has < 5 content words → no trigger", () => {
    const audio = "alpha bravo charlie delta echo foxtrot golf hotel india";
    const caption = "alpha bravo charlie delta";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
  });

  it("length gate: both have exactly 5 content words → passes gate (may trigger on Jaccard)", () => {
    const words = "alpha bravo charlie delta echo";
    const result = detectCaptionDuplication(words, words);
    // Both have 5 words, identical → Jaccard = 1.0, but ratio check: 5/5 = 1.0 >= 0.2
    expect(result.isDuplicate).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Ratio gate: caption < 20% of audio word count → no trigger
  // ---------------------------------------------------------------------------

  it("ratio gate: caption has fewer than 20% of audio content words → no trigger", () => {
    // audio: 30 content words, caption: 5 content words → ratio = 5/30 ≈ 0.167 < 0.2
    const audioWords = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const captionWords = "word0 word1 word2 word3 word4";
    const result = detectCaptionDuplication(audioWords, captionWords);
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
  });

  it("ratio gate: caption at exactly 20% of audio word count → passes gate", () => {
    // audio: 25 content words, caption: 5 content words → ratio = 5/25 = 0.2 exactly → passes
    // All 5 caption words are in audio → Jaccard = 5/25 = 0.2 < 0.7 → no trigger
    const audioWords = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const captionWords = "word0 word1 word2 word3 word4";
    const result = detectCaptionDuplication(audioWords, captionWords);
    // ratio gate passes (= 0.2), Jaccard = 5/25 = 0.2 < 0.7 → no trigger
    expect(result.isDuplicate).toBe(false);
    // But jaccard should be computed (not 0 from a gate), ratio passes so Jaccard is computed
    expect(result.jaccard).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Empty strings
  // ---------------------------------------------------------------------------

  it("empty audio string → no trigger (length gate)", () => {
    const result = detectCaptionDuplication("", "some caption text with many words here now");
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
    expect(result.audioWords).toBe(0);
  });

  it("empty caption string → no trigger (length gate)", () => {
    const result = detectCaptionDuplication("some audio text with many content words here", "");
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
    expect(result.captionWords).toBe(0);
  });

  it("both empty strings → no trigger", () => {
    const result = detectCaptionDuplication("", "");
    expect(result.isDuplicate).toBe(false);
    expect(result.jaccard).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Stopword filtering
  // ---------------------------------------------------------------------------

  it("stopwords are excluded from content word sets", () => {
    // If only stopwords are present, content word count will be 0 → length gate fires
    const audio = "the and or but if in on at to for";
    const caption = "the and or but if in on at to for";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
    expect(result.audioWords).toBe(0);
    expect(result.captionWords).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Result fields
  // ---------------------------------------------------------------------------

  it("result includes audioWords and captionWords counts", () => {
    const audio = "alpha bravo charlie delta echo foxtrot golf hotel india";
    const caption = "alpha bravo charlie delta echo";
    const result = detectCaptionDuplication(audio, caption);
    expect(typeof result.audioWords).toBe("number");
    expect(typeof result.captionWords).toBe("number");
    expect(result.audioWords).toBeGreaterThan(0);
    expect(result.captionWords).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Morphological inflection (no stemming by design)
  // ---------------------------------------------------------------------------

  it("does not trigger for inflected/stemmed variants (design: no stemming)", () => {
    // Audio and caption share the same semantic content but via inflected forms.
    // Jaccard operates on exact lowercased tokens — no stemming by design
    // (avoids false positives per task spec; conservative is correct).
    const audio = "the system is running smoothly today without issues";
    const caption = "system run smooth today issue free quickly";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Upper-ratio bound: caption > 3× audio word count → no trigger
  // ---------------------------------------------------------------------------

  it("does not trigger when caption is more than 3x audio word count", () => {
    // Caption much longer than audio — providing additional context, not restating.
    const audio = "weather update rain today";
    const caption = "detailed weather report: heavy rainfall expected throughout the region today with potential flooding in low-lying areas and strong winds gusting";
    const result = detectCaptionDuplication(audio, caption);
    expect(result.isDuplicate).toBe(false);
  });
});
