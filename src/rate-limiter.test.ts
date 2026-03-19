import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordRateLimit,
  isRateLimited,
  rateLimitRemainingSecs,
  enforceRateLimit,
  debounceSend,
  resetRateLimiterForTest,
  MIN_SEND_INTERVAL_MS,
} from "./rate-limiter.js";

describe("rate-limiter", () => {
  beforeEach(() => {
    resetRateLimiterForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetRateLimiterForTest();
    vi.useRealTimers();
  });

  // ── isRateLimited / recordRateLimit ───────────────────────────────────────

  describe("isRateLimited / recordRateLimit", () => {
    it("is not rate limited initially", () => {
      expect(isRateLimited()).toBe(false);
    });

    it("becomes rate limited after recording a window", () => {
      recordRateLimit(30);
      expect(isRateLimited()).toBe(true);
    });

    it("clears after the window expires", async () => {
      recordRateLimit(1);
      expect(isRateLimited()).toBe(true);
      await vi.advanceTimersByTimeAsync(1001);
      expect(isRateLimited()).toBe(false);
    });

    it("extends the window when a longer retry_after arrives", () => {
      recordRateLimit(5);
      recordRateLimit(30); // longer — should extend
      expect(isRateLimited()).toBe(true);
      // Should still be limited after 5 seconds (window extended to 30)
      vi.advanceTimersByTime(5001);
      expect(isRateLimited()).toBe(true);
    });

    it("does not shorten the window when a shorter retry_after arrives", () => {
      recordRateLimit(30);
      recordRateLimit(1); // shorter — should NOT override
      // Still limited after 1 second
      vi.advanceTimersByTime(1001);
      expect(isRateLimited()).toBe(true);
    });
  });

  // ── rateLimitRemainingSecs ─────────────────────────────────────────────────

  describe("rateLimitRemainingSecs", () => {
    it("returns 0 when not rate limited", () => {
      expect(rateLimitRemainingSecs()).toBe(0);
    });

    it("returns ceiling of remaining seconds", () => {
      recordRateLimit(10);
      // Immediately after recording — should be 10 s
      expect(rateLimitRemainingSecs()).toBe(10);
    });

    it("decreases as time passes", async () => {
      recordRateLimit(10);
      await vi.advanceTimersByTimeAsync(3000);
      expect(rateLimitRemainingSecs()).toBe(7);
    });

    it("returns 0 after window expires", async () => {
      recordRateLimit(1);
      await vi.advanceTimersByTimeAsync(1100);
      expect(rateLimitRemainingSecs()).toBe(0);
    });
  });

  // ── enforceRateLimit ──────────────────────────────────────────────────────

  describe("enforceRateLimit", () => {
    it("does not throw when not rate limited", () => {
      expect(() => { enforceRateLimit(); }).not.toThrow();
    });

    it("throws when currently rate limited", () => {
      recordRateLimit(30);
      expect(() => { enforceRateLimit(); }).toThrow();
    });

    it("throws error with code RATE_LIMITED", () => {
      recordRateLimit(30);
      try {
        enforceRateLimit();
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as { code: string }).code).toBe("RATE_LIMITED");
      }
    });

    it("thrown error includes retry_after seconds", () => {
      recordRateLimit(15);
      try {
        enforceRateLimit();
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as { retry_after: number }).retry_after).toBe(15);
      }
    });

    it("does not throw after window expires", async () => {
      recordRateLimit(1);
      await vi.advanceTimersByTimeAsync(1001);
      expect(() => { enforceRateLimit(); }).not.toThrow();
    });
  });

  // ── debounceSend ──────────────────────────────────────────────────────────

  describe("debounceSend", () => {
    it("resolves immediately on first call", async () => {
      let resolved = false;
      const p = debounceSend().then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(0);
      await p;
      expect(resolved).toBe(true);
    });

    it("waits MIN_SEND_INTERVAL_MS when called rapidly in succession", async () => {
      // First call
      await debounceSend();
      // Second call immediately — should not have resolved yet
      let resolved = false;
      const p = debounceSend().then(() => { resolved = true; });
      // Not resolved yet
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);
      // After MIN_SEND_INTERVAL_MS, resolves
      await vi.advanceTimersByTimeAsync(MIN_SEND_INTERVAL_MS);
      await p;
      expect(resolved).toBe(true);
    });

    it("resolves immediately after the interval has elapsed", async () => {
      await debounceSend();
      await vi.advanceTimersByTimeAsync(MIN_SEND_INTERVAL_MS + 10);
      // Now second call should resolve without waiting
      let resolved = false;
      const p = debounceSend().then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(0);
      await p;
      expect(resolved).toBe(true);
    });

    it("concurrent calls are serialized — second fires at least MIN_SEND_INTERVAL_MS after first", async () => {
      const timestamps: number[] = [];
      const record = () => { timestamps.push(Date.now()); };

      // Fire two concurrent debounceSend calls
      const p1 = debounceSend().then(record);
      const p2 = debounceSend().then(record);

      // Let the first one resolve (no delay on first call)
      await vi.advanceTimersByTimeAsync(0);
      await p1;

      // The second should still be waiting
      expect(timestamps).toHaveLength(1);

      // Advance enough for the second to complete
      await vi.advanceTimersByTimeAsync(MIN_SEND_INTERVAL_MS);
      await p2;

      expect(timestamps).toHaveLength(2);
      expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS);
    });
  });
});
