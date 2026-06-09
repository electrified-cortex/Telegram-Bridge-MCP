import { vi, describe, it, expect, beforeEach } from "vitest";

// Spy on the one external call warnUnrenderableChars makes
const mocks = vi.hoisted(() => ({
  deliverServiceMessage: vi.fn(),
}));

vi.mock("./session-queue.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, deliverServiceMessage: mocks.deliverServiceMessage };
});

import { findUnrenderableChars } from "./unrenderable-chars.js";
import {
  UNRENDERABLE_WARNING_ENABLED,
  setUnrenderableWarningEnabled,
  warnUnrenderableChars,
} from "./tools/send.js";

// ---------------------------------------------------------------------------
// findUnrenderableChars — pure detection
// ---------------------------------------------------------------------------

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
    const result = findUnrenderableChars("table│cell");
    expect(result).toContain("│");
  });

  it("detects block elements (range U+2580–U+259F)", () => {
    // U+2588 FULL BLOCK
    const result = findUnrenderableChars("█");
    expect(result).toContain("█");
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

// ---------------------------------------------------------------------------
// UNRENDERABLE_WARNING_ENABLED — defaults to false (disabled by default)
// ---------------------------------------------------------------------------

describe("UNRENDERABLE_WARNING_ENABLED", () => {
  it("defaults to false", () => {
    expect(UNRENDERABLE_WARNING_ENABLED).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// warnUnrenderableChars — gated by UNRENDERABLE_WARNING_ENABLED
// ---------------------------------------------------------------------------

describe("warnUnrenderableChars", () => {
  beforeEach(() => {
    setUnrenderableWarningEnabled(false);
    mocks.deliverServiceMessage.mockClear();
  });

  it("does NOT emit warning when flag is off (default)", () => {
    warnUnrenderableChars(1, "hello → world");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("does NOT emit warning for clean ASCII text even when flag is on", () => {
    setUnrenderableWarningEnabled(true);
    warnUnrenderableChars(1, "hello -> world");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("emits warning when flag is on and text contains arrow", () => {
    setUnrenderableWarningEnabled(true);
    warnUnrenderableChars(1, "hello → world");
    expect(mocks.deliverServiceMessage).toHaveBeenCalledOnce();
    const [sid, msg, eventType] = mocks.deliverServiceMessage.mock.calls[0] as [number, string, string];
    expect(sid).toBe(1);
    expect(msg).toContain("→");
    expect(eventType).toBe("unrenderable_chars_warning");
  });

  it("restores to no-emit after flag is reset to false", () => {
    setUnrenderableWarningEnabled(true);
    warnUnrenderableChars(1, "→");
    expect(mocks.deliverServiceMessage).toHaveBeenCalledOnce();

    mocks.deliverServiceMessage.mockClear();
    setUnrenderableWarningEnabled(false);
    warnUnrenderableChars(1, "→");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });
});
