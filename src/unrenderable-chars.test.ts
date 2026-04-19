import { describe, it, expect } from "vitest";
import { findUnrenderableChars } from "./unrenderable-chars.js";

describe("findUnrenderableChars", () => {
  it("returns [] for empty string", () => {
    expect(findUnrenderableChars("")).toEqual([]);
  });

  it("returns [] for plain ASCII text", () => {
    expect(findUnrenderableChars("hello world")).toEqual([]);
  });

  it("detects RIGHTWARDS ARROW →", () => {
    expect(findUnrenderableChars("use → not ->")).toEqual(["→"]);
  });

  it("does not flag EM DASH — (renders fine in Telegram)", () => {
    expect(findUnrenderableChars("—")).toEqual([]);
  });

  it("detects both arrows in a sentence", () => {
    const result = findUnrenderableChars("normal → and ← arrows");
    expect(result).toContain("→");
    expect(result).toContain("←");
    expect(result).toHaveLength(2);
  });

  it("detects HORIZONTAL ELLIPSIS …", () => {
    expect(findUnrenderableChars("wait…")).toEqual(["…"]);
  });

  it("does not flag EN DASH – (renders fine in Telegram)", () => {
    expect(findUnrenderableChars("2–4")).toEqual([]);
  });

  it("detects curly quotes", () => {
    const result = findUnrenderableChars("\u201Chello\u201D");
    expect(result).toContain("\u201C");
    expect(result).toContain("\u201D");
  });

  it("detects box-drawing characters (range U+2500–U+257F)", () => {
    // U+2502 BOX DRAWINGS LIGHT VERTICAL
    const result = findUnrenderableChars("table\u2502cell");
    expect(result).toContain("\u2502");
  });

  it("detects block elements (range U+2580–U+259F)", () => {
    // U+2588 FULL BLOCK
    const result = findUnrenderableChars("\u2588");
    expect(result).toContain("\u2588");
  });

  it("deduplicates repeated problematic characters", () => {
    const result = findUnrenderableChars("→ then → again");
    expect(result).toEqual(["→"]);
  });

  it("does not flag standard Unicode letters or emoji", () => {
    expect(findUnrenderableChars("Ñoño 日本語")).toEqual([]);
    expect(findUnrenderableChars("ok 👍")).toEqual([]);
  });

  it("detects DOUBLE ARROW ⇒", () => {
    expect(findUnrenderableChars("A ⇒ B")).toEqual(["⇒"]);
  });

  it("does not flag Regional Indicator / flag emoji (🇺🇸, 🇬🇧)", () => {
    // U+1F1FA (🇺) + U+1F1F8 (🇸) compose the US flag emoji 🇺🇸
    // U+1F1EC (🇬) + U+1F1E7 (🇧) compose the GB flag emoji 🇬🇧
    expect(findUnrenderableChars("🇺🇸")).toEqual([]);
    expect(findUnrenderableChars("🇬🇧")).toEqual([]);
    expect(findUnrenderableChars("Flags: 🇺🇸 🇬🇧 🇯🇵")).toEqual([]);
  });
});
