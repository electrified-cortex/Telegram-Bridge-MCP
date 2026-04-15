import { describe, it, expect, beforeEach, vi } from "vitest";
import { setPlannedBounce, isPlannedBounce, resetBounceStateForTest } from "./bounce-state.js";

beforeEach(() => {
  resetBounceStateForTest();
  vi.useRealTimers();
});

describe("bounce-state", () => {
  it("starts as false", () => {
    expect(isPlannedBounce()).toBe(false);
  });

  it("setPlannedBounce(true) makes isPlannedBounce() return true", () => {
    setPlannedBounce(true);
    expect(isPlannedBounce()).toBe(true);
  });

  it("setPlannedBounce(false) makes isPlannedBounce() return false", () => {
    setPlannedBounce(true);
    setPlannedBounce(false);
    expect(isPlannedBounce()).toBe(false);
  });

  it("resetBounceStateForTest resets flag to false", () => {
    setPlannedBounce(true);
    resetBounceStateForTest();
    expect(isPlannedBounce()).toBe(false);
  });

  it("flag is still valid within the bounce window", () => {
    vi.useFakeTimers();
    setPlannedBounce(true);
    // Advance by 9 minutes — still within the 10-minute window
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(isPlannedBounce()).toBe(true);
  });

  it("flag expires after the bounce window closes", () => {
    vi.useFakeTimers();
    setPlannedBounce(true);
    // Advance by 10 minutes + 1 ms — window has elapsed
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(isPlannedBounce()).toBe(false);
  });
});
