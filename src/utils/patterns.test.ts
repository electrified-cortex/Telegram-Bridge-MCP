import { describe, it, expect } from "vitest";
import { DIGITS_ONLY } from "./patterns.js";

describe("DIGITS_ONLY", () => {
  describe("accepts non-empty strings of only ASCII digits", () => {
    it.each(["0", "1", "123", "0123", "9999999999"])(
      "accepts %j",
      (input) => {
        expect(DIGITS_ONLY.test(input)).toBe(true);
      }
    );
  });

  describe("rejects empty string", () => {
    it("rejects empty string", () => {
      expect(DIGITS_ONLY.test("")).toBe(false);
    });
  });

  describe("rejects strings with non-digit characters", () => {
    it.each(["a", "1a", "a1", "1.0", "1 2", "-1", "+1", " 1", "1 ", "1\n2"])(
      "rejects %j",
      (input) => {
        expect(DIGITS_ONLY.test(input)).toBe(false);
      }
    );
  });

  describe("rejects Unicode digit lookalikes", () => {
    it.each([
      "\u{FF10}", // ０ FULLWIDTH DIGIT ZERO
      "\u{0660}", // ٠ ARABIC-INDIC DIGIT ZERO
      "\u{06F0}", // ۰ EXTENDED ARABIC-INDIC DIGIT ZERO
    ])("rejects Unicode lookalike %j", (input) => {
      expect(DIGITS_ONLY.test(input)).toBe(false);
    });
  });
});
