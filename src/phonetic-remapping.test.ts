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
    expect(applyPhoneticRemapping("Say hello to nginx", undefined)).toBe(
      "Say hello to nginx",
    );
  });

  it("returns input unchanged when map is empty", () => {
    expect(applyPhoneticRemapping("Say hello to nginx", {})).toBe(
      "Say hello to nginx",
    );
  });

  // ── Basic substitution ───────────────────────────────────────────────────

  it("replaces a matching key with its replacement", () => {
    expect(
      applyPhoneticRemapping("Say hello to nginx", { "nginx": "engine-x" }),
    ).toBe("Say hello to engine-x");
  });

  it("logs each substitution at debug level (AC5)", () => {
    applyPhoneticRemapping("Say hello to nginx", { "nginx": "engine-x" });
    expect(vi.mocked(dlog)).toHaveBeenCalledWith(
      "phonetic-remapping",
      "'nginx' → 'engine-x'",
    );
  });

  it("returns input unchanged when map has only empty-string keys", () => {
    expect(
      applyPhoneticRemapping("hello world", { "": "should-not-match" }),
    ).toBe("hello world");
  });

  it("skips empty-string keys but applies valid keys in same map", () => {
    expect(
      applyPhoneticRemapping("Say hello to nginx", { "": "boom", "nginx": "engine-x" }),
    ).toBe("Say hello to engine-x");
  });

  it("keeps original text when no key matches", () => {
    expect(
      applyPhoneticRemapping("Nothing to replace here", { "nginx": "engine-x" }),
    ).toBe("Nothing to replace here");
  });

  // ── Case-insensitive matching ────────────────────────────────────────────

  it("matches lowercased input (nginx)", () => {
    expect(
      applyPhoneticRemapping("Say hello to nginx", { "nginx": "engine-x" }),
    ).toBe("Say hello to engine-x");
  });

  it("matches uppercased input (NGINX)", () => {
    expect(
      applyPhoneticRemapping("Say hello to NGINX", { "nginx": "engine-x" }),
    ).toBe("Say hello to engine-x");
  });

  it("matches mixed-case input (nGinx)", () => {
    expect(
      applyPhoneticRemapping("Say hello to nGinx", { "nginx": "engine-x" }),
    ).toBe("Say hello to engine-x");
  });

  it("uses the replacement verbatim (case of replacement is preserved)", () => {
    const result = applyPhoneticRemapping("alice said NGINX", {
      "nginx": "ENGINE-X",
    });
    expect(result).toBe("alice said ENGINE-X");
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
    const map = { "nginx": "engine-x", "SQL": "sequel" };
    expect(
      applyPhoneticRemapping("nginx and SQL are here", map),
    ).toBe("engine-x and sequel are here");
  });

  it("replaces all occurrences of a key in the string", () => {
    const map = { "nginx": "engine-x" };
    expect(
      applyPhoneticRemapping("nginx loves nginx", map),
    ).toBe("engine-x loves engine-x");
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
    expect(applyPhoneticRemapping("", { "nginx": "engine-x" })).toBe("");
  });

  it("handles map with a single empty-string value (replaces match with '')", () => {
    const map = { "silence": "" };
    expect(applyPhoneticRemapping("total silence reigns", map)).toBe(
      "total  reigns",
    );
  });
});
