import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  activateAutoApproveOne,
  activateAutoApproveTimed,
  cancelAutoApprove,
  checkAndConsumeAutoApprove,
  getAutoApproveState,
} from "./auto-approve.js";

describe("auto-approve", () => {
  beforeEach(() => {
    // Reset state before each test
    cancelAutoApprove();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAutoApprove();
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("starts with mode none", () => {
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("checkAndConsumeAutoApprove returns false when mode is none", () => {
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });
  });

  describe("activateAutoApproveOne", () => {
    it("sets mode to one", () => {
      activateAutoApproveOne();
      expect(getAutoApproveState().mode).toBe("one");
    });

    it("checkAndConsumeAutoApprove returns true on first call", () => {
      activateAutoApproveOne();
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("consumes the token — second call returns false", () => {
      activateAutoApproveOne();
      checkAndConsumeAutoApprove(); // consume
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });

    it("mode resets to none after consumption", () => {
      activateAutoApproveOne();
      checkAndConsumeAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("activateAutoApproveTimed", () => {
    it("sets mode to timed", () => {
      activateAutoApproveTimed(60_000);
      expect(getAutoApproveState().mode).toBe("timed");
    });

    it("sets expiresAt in the future", () => {
      const before = Date.now();
      activateAutoApproveTimed(60_000);
      const state = getAutoApproveState();
      expect(state.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    });

    it("checkAndConsumeAutoApprove returns true during window", () => {
      activateAutoApproveTimed(60_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("does not consume token — multiple calls return true during window", () => {
      activateAutoApproveTimed(60_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);
      expect(checkAndConsumeAutoApprove()).toBe(true);
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("returns false after expiry via timer", () => {
      activateAutoApproveTimed(5_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);

      vi.advanceTimersByTime(5_001);

      expect(getAutoApproveState().mode).toBe("none");
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });

    it("returns false when checked after expiry time (expiresAt guard)", () => {
      activateAutoApproveTimed(1_000);
      // advance time past expiry without firing timer
      vi.setSystemTime(Date.now() + 2_000);
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });
  });

  describe("cancelAutoApprove", () => {
    it("resets mode to none from one", () => {
      activateAutoApproveOne();
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("resets mode to none from timed", () => {
      activateAutoApproveTimed(60_000);
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("clears the timed timer so it does not fire later", () => {
      activateAutoApproveTimed(5_000);
      cancelAutoApprove();
      // If timer was not cleared, advancing past expiry would be a no-op on
      // already-reset state — but we confirm state stays none after time passes
      vi.advanceTimersByTime(10_000);
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("is idempotent — calling cancel when already none is safe", () => {
      cancelAutoApprove();
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("activateAutoApproveOne while timed is active", () => {
    it("cancels the timed timer and switches to one", () => {
      activateAutoApproveTimed(60_000);
      expect(getAutoApproveState().mode).toBe("timed");

      activateAutoApproveOne();
      expect(getAutoApproveState().mode).toBe("one");

      // Confirm timed timer was cleared — advancing time should not reset to none
      vi.advanceTimersByTime(70_000);
      // state is "one" until consumed (timer was cancelled, not fired again)
      // The state may have changed to none if activateAutoApproveOne's cancel
      // properly cleaned up. It should remain "one" since no new timer was set.
      expect(getAutoApproveState().mode).toBe("one");
    });

    it("consuming the one token leaves mode none, not timed", () => {
      activateAutoApproveTimed(60_000);
      activateAutoApproveOne();
      checkAndConsumeAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("getAutoApproveState", () => {
    it("reflects none initially", () => {
      expect(getAutoApproveState()).toEqual({ mode: "none" });
    });

    it("reflects one after activateAutoApproveOne", () => {
      activateAutoApproveOne();
      expect(getAutoApproveState()).toEqual({ mode: "one" });
    });

    it("reflects timed with expiresAt after activateAutoApproveTimed", () => {
      const now = Date.now();
      activateAutoApproveTimed(30_000);
      const state = getAutoApproveState();
      expect(state.mode).toBe("timed");
      expect(state.expiresAt).toBeGreaterThanOrEqual(now + 30_000);
    });
  });
});
