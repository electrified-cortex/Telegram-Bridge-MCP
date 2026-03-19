import { describe, it, expect } from "vitest";
import { hasEmoji, validateButtonSymbolParity } from "./button-validation.js";

describe("hasEmoji", () => {
  it("returns true for a label containing an emoji", () => {
    expect(hasEmoji("✅ Yes")).toBe(true);
  });

  it("returns true for a label with a pictographic symbol", () => {
    expect(hasEmoji("❌ No")).toBe(true);
  });

  it("returns false for a plain text label", () => {
    expect(hasEmoji("Yes")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasEmoji("")).toBe(false);
  });

  it("returns true for label with emoji at the end", () => {
    expect(hasEmoji("Continue 🚀")).toBe(true);
  });
});

describe("validateButtonSymbolParity", () => {
  it("returns ok=true when all labels have emoji", () => {
    const result = validateButtonSymbolParity(["✅ Yes", "❌ No"]);
    expect(result.ok).toBe(true);
    expect(result.withEmoji).toEqual(["✅ Yes", "❌ No"]);
    expect(result.withoutEmoji).toEqual([]);
  });

  it("returns ok=true when no labels have emoji", () => {
    const result = validateButtonSymbolParity(["Yes", "No", "Maybe"]);
    expect(result.ok).toBe(true);
    expect(result.withEmoji).toEqual([]);
    expect(result.withoutEmoji).toEqual(["Yes", "No", "Maybe"]);
  });

  it("returns ok=false when some labels have emoji and others do not", () => {
    const result = validateButtonSymbolParity(["✅ Yes", "❌ No", "Maybe"]);
    expect(result.ok).toBe(false);
    expect(result.withEmoji).toEqual(["✅ Yes", "❌ No"]);
    expect(result.withoutEmoji).toEqual(["Maybe"]);
  });

  it("returns ok=false for single emoji vs single plain", () => {
    const result = validateButtonSymbolParity(["🟢 Go", "Stop"]);
    expect(result.ok).toBe(false);
    expect(result.withEmoji).toEqual(["🟢 Go"]);
    expect(result.withoutEmoji).toEqual(["Stop"]);
  });

  it("returns ok=true for a single label (no parity conflict possible)", () => {
    const result = validateButtonSymbolParity(["Only"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok=true for empty array", () => {
    const result = validateButtonSymbolParity([]);
    expect(result.ok).toBe(true);
  });
});
