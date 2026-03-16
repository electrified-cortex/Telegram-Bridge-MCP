import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
}));

vi.mock("./telegram.js", () => ({
  getApi: () => ({ deleteMessage: mocks.deleteMessage }),
}));

import {
  setPendingTemp,
  clearPendingTemp,
  hasPendingTemp,
} from "./temp-message.js";

describe("temp-message", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.deleteMessage.mockResolvedValue(true);
    // Clear any leftover state from previous test
    clearPendingTemp();
    vi.runAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- setPendingTemp ------------------------------------------------------

  it("registers a pending temp message", () => {
    setPendingTemp(1, 10, 60);
    expect(hasPendingTemp()).toBe(true);
  });

  it("deletes previous temp when setting a new one", () => {
    setPendingTemp(1, 10, 60);
    setPendingTemp(1, 20, 60);
    expect(hasPendingTemp()).toBe(true);
    // Previous message should be deleted immediately
    expect(mocks.deleteMessage).toHaveBeenCalledWith(1, 10);
  });

  it("auto-deletes after TTL expires", () => {
    setPendingTemp(1, 10, 5);
    expect(hasPendingTemp()).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(hasPendingTemp()).toBe(false);
    expect(mocks.deleteMessage).toHaveBeenCalledWith(1, 10);
  });

  it("uses default TTL of 300s", () => {
    setPendingTemp(1, 10);
    expect(hasPendingTemp()).toBe(true);

    vi.advanceTimersByTime(299_999);
    expect(hasPendingTemp()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(hasPendingTemp()).toBe(false);
  });

  // -- clearPendingTemp ----------------------------------------------------

  it("schedules GRACE_SECONDS (10s) delayed delete", () => {
    setPendingTemp(1, 10, 60);
    clearPendingTemp();
    expect(hasPendingTemp()).toBe(false);

    // Not deleted yet — grace period
    expect(mocks.deleteMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(mocks.deleteMessage).toHaveBeenCalledWith(1, 10);
  });

  it("is a no-op when nothing is pending", () => {
    clearPendingTemp(); // should not throw
    expect(hasPendingTemp()).toBe(false);
  });

  it("cancels the TTL timer on clear", () => {
    setPendingTemp(1, 10, 5);
    clearPendingTemp();

    // Advance past grace period (10s) + original TTL (5s)
    vi.advanceTimersByTime(11_000);
    // Only the grace-period delete — TTL timer was cancelled
    expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
  });

  // -- hasPendingTemp ------------------------------------------------------

  it("returns false when nothing pending", () => {
    expect(hasPendingTemp()).toBe(false);
  });

  // -- Error handling ------------------------------------------------------

  it("swallows deleteMessage errors", () => {
    mocks.deleteMessage.mockRejectedValue(new Error("gone"));
    setPendingTemp(1, 10, 1);
    vi.advanceTimersByTime(1000);
    // Should not throw even though deleteMessage fails
    expect(hasPendingTemp()).toBe(false);
  });
});
