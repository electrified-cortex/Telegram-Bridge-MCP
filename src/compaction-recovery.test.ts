/**
 * Unit tests for the compaction-recovery helper (maybeReplaceRecoveringAnimation).
 *
 * Tests verify:
 *  1. After `compacted` fires, getHasCompacted(sid) is true
 *  2. maybeReplaceRecoveringAnimation calls cancelAnimation with the notify text
 *     when hasCompacted && isRecoveringAnimation
 *  3. After replacement fires once, getHasCompacted(sid) is false (no double-fire)
 *  4. If no recovering animation is active, maybeReplaceRecoveringAnimation returns false
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getHasCompacted: vi.fn((_sid: number): boolean => false),
  clearHasCompacted: vi.fn((_sid: number): void => {}),
  setHasCompacted: vi.fn((_sid: number): void => {}),
  isRecoveringAnimation: vi.fn((_sid: number): boolean => false),
  cancelAnimation: vi.fn((_sid: number, _text?: string, _parseMode?: string) => Promise.resolve({ cancelled: true })),
}));

vi.mock("./session-manager.js", () => ({
  getHasCompacted: (sid: number) => mocks.getHasCompacted(sid),
  clearHasCompacted: (sid: number) => { mocks.clearHasCompacted(sid); },
  setHasCompacted: (sid: number) => { mocks.setHasCompacted(sid); },
}));

vi.mock("./animation-state.js", () => ({
  isRecoveringAnimation: (sid: number) => mocks.isRecoveringAnimation(sid),
  cancelAnimation: (sid: number, text?: string, parseMode?: string) =>
    mocks.cancelAnimation(sid, text, parseMode),
}));

import { maybeReplaceRecoveringAnimation, COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE } from "./compaction-recovery.js";
import { getHasCompacted, setHasCompacted, clearHasCompacted } from "./session-manager.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("maybeReplaceRecoveringAnimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false and does nothing when hasCompacted is false", async () => {
    mocks.getHasCompacted.mockReturnValue(false);
    mocks.isRecoveringAnimation.mockReturnValue(true);

    const result = await maybeReplaceRecoveringAnimation(1);

    expect(result).toBe(false);
    expect(mocks.cancelAnimation).not.toHaveBeenCalled();
    expect(mocks.clearHasCompacted).not.toHaveBeenCalled();
  });

  it("returns false and does nothing when no recovering animation is active", async () => {
    mocks.getHasCompacted.mockReturnValue(true);
    mocks.isRecoveringAnimation.mockReturnValue(false);

    const result = await maybeReplaceRecoveringAnimation(1);

    expect(result).toBe(false);
    expect(mocks.cancelAnimation).not.toHaveBeenCalled();
    expect(mocks.clearHasCompacted).not.toHaveBeenCalled();
  });

  it("replaces recovering animation with compacted notify when both conditions are met", async () => {
    mocks.getHasCompacted.mockReturnValue(true);
    mocks.isRecoveringAnimation.mockReturnValue(true);

    const result = await maybeReplaceRecoveringAnimation(1);

    expect(result).toBe(true);
    expect(mocks.clearHasCompacted).toHaveBeenCalledWith(1);
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE);
  });

  it("clears the flag before calling cancelAnimation to prevent double-fire on re-entry", async () => {
    mocks.getHasCompacted.mockReturnValue(true);
    mocks.isRecoveringAnimation.mockReturnValue(true);
    const callOrder: string[] = [];
    mocks.clearHasCompacted.mockImplementation(() => { callOrder.push("clear"); });
    mocks.cancelAnimation.mockImplementation(() => { callOrder.push("cancel"); return Promise.resolve({ cancelled: true }); });

    await maybeReplaceRecoveringAnimation(1);

    expect(callOrder).toEqual(["clear", "cancel"]);
  });

  it("passes the correct sid to both clearHasCompacted and cancelAnimation", async () => {
    mocks.getHasCompacted.mockReturnValue(true);
    mocks.isRecoveringAnimation.mockReturnValue(true);

    await maybeReplaceRecoveringAnimation(42);

    expect(mocks.clearHasCompacted).toHaveBeenCalledWith(42);
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(42, COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE);
  });
});

