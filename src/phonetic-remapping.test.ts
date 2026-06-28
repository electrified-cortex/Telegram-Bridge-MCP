import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyPhoneticRemapping } from "./phonetic-remapping.js";
import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// Mock dlog so tests don't need debug mode enabled and produce no stderr output
// ---------------------------------------------------------------------------
vi.mock("./debug-log.js", () => ({
  dlog: vi.fn(),
}));

// ---------------------------------------------------------------------------
// applyPhoneticRemapping
// ---------------------------------------------------------------------------

describe("applyPhoneticRemapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── No-op cases ─────────────────────────────────────────────────────────

  it("returns input unchanged when map is undefined", () => {
    expect(applyPhoneticRemapping("Say hello to Zhu-Li", undefined)).toBe(
      "Say hello to Zhu-Li",
    );
  });

  it("returns input unchanged when map is empty", () => {
    expect(applyPhoneticRemapping("Say hello to Zhu-Li", {})).toBe(
      "Say hello to Zhu-Li",
    );
  });

  // ── Basic substitution ───────────────────────────────────────────────────

  it("replaces a matching key with its replacement", () => {
    expect(
      applyPhoneticRemapping("Say hello to Zhu-Li", { "Zhu-Li": "Joo-Lee" }),
    ).toBe("Say hello to Joo-Lee");
  });

  it("logs each substitution at debug level (AC5)", () => {
    applyPhoneticRemapping("Say hello to Zhu-Li", { "Zhu-Li": "Joo-Lee" });
    expect(vi.mocked(dlog)).toHaveBeenCalledWith(
      "phonetic-remapping",
      "'Zhu-Li' → 'Joo-Lee'",
    );
  });

  it("returns input unchanged when map has only empty-string keys", () => {
    expect(
      applyPhoneticRemapping("hello world", { "": "should-not-match" }),
    ).toBe("hello world");
  });

  it("skips empty-string keys but applies valid keys in same map", () => {
    expect(
      applyPhoneticRemapping("Say hello to Zhu-Li", { "": "boom", "Zhu-Li": "Joo-Lee" }),
    ).toBe("Say hello to Joo-Lee");
  });

  it("keeps original text when no key matches", () => {
    expect(
      applyPhoneticRemapping("Nothing to replace here", { "Zhu-Li": "Joo-Lee" }),
    ).toBe("Nothing to replace here");
  });

  // ── Case-insensitive matching ────────────────────────────────────────────

  it("matches lowercased input (zhu-li)", () => {
    expect(
      applyPhoneticRemapping("Say hello to zhu-li", { "Zhu-Li": "Joo-Lee" }),
    ).toBe("Say hello to Joo-Lee");
  });

  it("matches uppercased input (ZHU-LI)", () => {
    expect(
      applyPhoneticRemapping("Say hello to ZHU-LI", { "Zhu-Li": "Joo-Lee" }),
    ).toBe("Say hello to Joo-Lee");
  });

  it("matches mixed-case input (zHu-Li)", () => {
    expect(
      applyPhoneticRemapping("Say hello to zHu-Li", { "Zhu-Li": "Joo-Lee" }),
    ).toBe("Say hello to Joo-Lee");
  });

  it("uses the replacement verbatim (case of replacement is preserved)", () => {
    const result = applyPhoneticRemapping("alice said ZHU-LI", {
      "Zhu-Li": "JOO-LEE",
    });
    expect(result).toBe("alice said JOO-LEE");
  });

  // ── Longer-match-wins ────────────────────────────────────────────────────

  it("longer key wins when shorter key is a prefix (ZeroClaw vs Zero)", () => {
    const map = { Zero: "Zee-Row", ZeroClaw: "Zee-Row-Claw" };
    expect(applyPhoneticRemapping("ZeroClaw attacks", map)).toBe(
      "Zee-Row-Claw attacks",
    );
  });

  it("shorter key still matches when longer key is absent in text", () => {
    const map = { Zero: "Zee-Row", ZeroClaw: "Zee-Row-Claw" };
    expect(applyPhoneticRemapping("Zero attacks", map)).toBe("Zee-Row attacks");
  });

  it("longer key wins over shorter suffix key", () => {
    const map = { "Claw": "Klaa", "ZeroClaw": "Zee-Row-Claw" };
    expect(applyPhoneticRemapping("ZeroClaw strikes", map)).toBe(
      "Zee-Row-Claw strikes",
    );
  });

  // ── Multiple substitutions in one string ─────────────────────────────────

  it("applies multiple distinct substitutions in one pass", () => {
    const map = { "Zhu-Li": "Joo-Lee", "Varrick": "Vah-Rick" };
    expect(
      applyPhoneticRemapping("Zhu-Li and Varrick are here", map),
    ).toBe("Joo-Lee and Vah-Rick are here");
  });

  it("replaces all occurrences of a key in the string", () => {
    const map = { "Zhu-Li": "Joo-Lee" };
    expect(
      applyPhoneticRemapping("Zhu-Li loves Zhu-Li", map),
    ).toBe("Joo-Lee loves Joo-Lee");
  });

  // ── Replacement strings with $ characters ───────────────────────────────

  it("treats $ in replacement literally (no $-interpolation)", () => {
    const map = { "dollar": "$100" };
    expect(applyPhoneticRemapping("It costs one dollar", map)).toBe(
      "It costs one $100",
    );
  });

  it("treats $& in replacement literally (not the matched substring)", () => {
    const map = { "foo": "$&bar" };
    expect(applyPhoneticRemapping("foo baz", map)).toBe("$&bar baz");
  });

  // ── Regex metacharacter safety ────────────────────────────────────────────

  it("matches a key with dots literally (not as regex wildcards)", () => {
    const map = { "v1.0.0": "version one" };
    expect(applyPhoneticRemapping("installed v1.0.0 today", map)).toBe(
      "installed version one today",
    );
  });

  it("matches a key with parentheses literally", () => {
    const map = { "AI (v2)": "A I version two" };
    expect(applyPhoneticRemapping("using AI (v2) now", map)).toBe(
      "using A I version two now",
    );
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("handles empty input string", () => {
    expect(applyPhoneticRemapping("", { "Zhu-Li": "Joo-Lee" })).toBe("");
  });

  it("handles map with a single empty-string value (replaces match with '')", () => {
    const map = { "silence": "" };
    expect(applyPhoneticRemapping("total silence reigns", map)).toBe(
      "total  reigns",
    );
  });
});
