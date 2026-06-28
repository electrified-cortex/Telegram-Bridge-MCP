/**
 * Tests for thinking-state.ts — per-session Thinking indicator manager.
 *
 * Harness-agnostic: no real Telegram IDs. SIM payloads ASCII-only.
 * All Telegram API calls are mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "./telegram.js";

// ---------------------------------------------------------------------------
// Mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendMessageDraft: vi.fn().mockResolvedValue(true as true),
  resolveChat: vi.fn((): number | TelegramError => 100),
  getApi: vi.fn(),
}));

// Set up getApi to return the mock object
mocks.getApi.mockReturnValue({ sendMessageDraft: mocks.sendMessageDraft });

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks.getApi(),
    resolveChat: () => mocks.resolveChat(),
  };
});

import {
  onActionableDequeue,
  cancelThinkingForSid,
  isThinkingActive,
  extendThinking,
  closeThinking,
  removeThinkingState,
  _resetThinkingStateForTest,
  _getHoldUntilForTest,
  _getDraftIdForTest,
  _getPhasesForTest,
  _getLabelForTest,
  DEFAULT_HOLD_MS,
} from "./thinking-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SID = 42;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("thinking-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetThinkingStateForTest();
    vi.useFakeTimers();
    // Default: resolveChat returns a valid chat ID
    mocks.resolveChat.mockReturnValue(100);
    // Default: sendMessageDraft succeeds
    mocks.sendMessageDraft.mockResolvedValue(true);
    mocks.getApi.mockReturnValue({ sendMessageDraft: mocks.sendMessageDraft });
  });

  afterEach(() => {
    _resetThinkingStateForTest();
    vi.useRealTimers();
  });

  // ── AC1: Actionable dequeue fires Thinking ──────────────────────────────

  describe("onActionableDequeue — start thinking", () => {
    it("fires sendMessageDraft with empty text on first call", async () => {
      await onActionableDequeue(SID);
      expect(mocks.sendMessageDraft).toHaveBeenCalledOnce();
      const [chatId, _draftId, text] = mocks.sendMessageDraft.mock.calls[0] as [number, number, string];
      expect(chatId).toBe(100);
      expect(text).toBe("");
    });

    it("sets isThinkingActive to true", async () => {
      await onActionableDequeue(SID);
      expect(isThinkingActive(SID)).toBe(true);
    });

    it("sets holdUntil approximately 30s from now", async () => {
      const before = Date.now();
      await onActionableDequeue(SID);
      const after = Date.now();
      const holdUntil = _getHoldUntilForTest(SID);
      expect(holdUntil).toBeGreaterThanOrEqual(before + DEFAULT_HOLD_MS);
      expect(holdUntil).toBeLessThanOrEqual(after + DEFAULT_HOLD_MS + 50);
    });

    it("never throws even if sendMessageDraft rejects", async () => {
      mocks.sendMessageDraft.mockRejectedValueOnce(new Error("network error"));
      await expect(onActionableDequeue(SID)).resolves.toBeUndefined();
    });

    it("is a no-op when resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValue({ code: "UNAUTHORIZED_CHAT", message: "no chat" });
      await onActionableDequeue(SID);
      expect(mocks.sendMessageDraft).not.toHaveBeenCalled();
      expect(isThinkingActive(SID)).toBe(false);
    });

    it("uses a different draft ID for each new thinking period", async () => {
      await onActionableDequeue(SID);
      const id1 = _getDraftIdForTest(SID);
      cancelThinkingForSid(SID);

      await onActionableDequeue(SID);
      const id2 = _getDraftIdForTest(SID);

      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
      expect(id1).not.toBe(id2);
    });
  });

  // ── AC2: Non-actionable dequeues do NOT fire thinking ──────────────────
  // (This is tested in dequeue.test.ts via _fireThinkingIfActionable;
  //  here we verify onActionableDequeue is NOT called for wrong event types
  //  by testing that thinking stays inactive when chat is unavailable.)

  // ── AC3: Refresh is floor-not-cap ──────────────────────────────────────

  describe("onActionableDequeue — floor bump refresh", () => {
    it("does NOT re-fire draft if holdUntil is already >= 30s from now", async () => {
      await onActionableDequeue(SID);
      expect(mocks.sendMessageDraft).toHaveBeenCalledTimes(1);

      // Immediately call again (holdUntil is still ~30s from now)
      await onActionableDequeue(SID);

      // No re-fire: holdUntil >= now + 30s still
      expect(mocks.sendMessageDraft).toHaveBeenCalledTimes(1);
    });

    it("re-fires draft when holdUntil < 30s from now (near expiry)", async () => {
      await onActionableDequeue(SID);
      expect(mocks.sendMessageDraft).toHaveBeenCalledTimes(1);

      // Simulate time passing — holdUntil is now only 5s away
      vi.advanceTimersByTime(DEFAULT_HOLD_MS - 5000);

      // New actionable dequeue: holdUntil < now + 30s → floor bump → re-fire
      await onActionableDequeue(SID);
      expect(mocks.sendMessageDraft).toHaveBeenCalledTimes(2);
    });

    it("does NOT shorten an agent-extended hold (floor-not-cap)", async () => {
      await onActionableDequeue(SID);

      // Agent extends to 120s
      await extendThinking(SID, { hold: 120 });
      const holdAfterExtend = _getHoldUntilForTest(SID);
      expect(holdAfterExtend).toBeGreaterThan(Date.now() + 60000); // > 60s remaining

      // New actionable dequeue: now + 30s < holdAfterExtend → no change
      await onActionableDequeue(SID);
      const holdAfterRefresh = _getHoldUntilForTest(SID);
      expect(holdAfterRefresh).toBe(holdAfterExtend); // unchanged
    });
  });

  // ── AC4: cancelThinkingForSid ──────────────────────────────────────────

  describe("cancelThinkingForSid", () => {
    it("deactivates thinking", async () => {
      await onActionableDequeue(SID);
      expect(isThinkingActive(SID)).toBe(true);

      cancelThinkingForSid(SID);
      expect(isThinkingActive(SID)).toBe(false);
    });

    it("is a no-op when thinking is not active", () => {
      expect(() => cancelThinkingForSid(SID)).not.toThrow();
      expect(isThinkingActive(SID)).toBe(false);
    });

    it("does NOT send a draft cancel request (draft expires naturally)", async () => {
      await onActionableDequeue(SID);
      mocks.sendMessageDraft.mockClear();

      cancelThinkingForSid(SID);
      // Allow any async work to settle
      await vi.runAllTimersAsync();

      expect(mocks.sendMessageDraft).not.toHaveBeenCalled();
    });
  });

  // ── AC5: extendThinking — agent extension API ──────────────────────────

  describe("extendThinking", () => {
    it("starts thinking if not already active", async () => {
      const result = await extendThinking(SID, { label: "Working…" });
      expect(result.ok).toBe(true);
      expect(isThinkingActive(SID)).toBe(true);
      expect(mocks.sendMessageDraft).toHaveBeenCalledOnce();
    });

    it("sends label as draft text", async () => {
      await extendThinking(SID, { label: "Crunching data…" });
      const [, , text] = mocks.sendMessageDraft.mock.calls[0] as [number, number, string];
      expect(text).toBe("Crunching data…");
    });

    it("sets hold duration", async () => {
      await extendThinking(SID, { hold: 90 });
      const holdUntil = _getHoldUntilForTest(SID);
      expect(holdUntil).toBeGreaterThan(Date.now() + 60000); // > 60s remaining
    });

    it("stores label on state", async () => {
      await extendThinking(SID, { label: "Processing…" });
      expect(_getLabelForTest(SID)).toBe("Processing…");
    });

    it("stores phases on state", async () => {
      const phases = ["Reading files", "Running tests", "Drafting"];
      await extendThinking(SID, { phases });
      expect(_getPhasesForTest(SID)).toEqual(phases);
    });

    it("does not shorten an existing hold (floor-not-cap)", async () => {
      // First extend: 120s hold
      await extendThinking(SID, { hold: 120 });
      const hold1 = _getHoldUntilForTest(SID);

      // Second extend with shorter hold (30s) — should NOT shorten
      await extendThinking(SID, { hold: 30 });
      const hold2 = _getHoldUntilForTest(SID);
      expect(hold2).toBe(hold1); // unchanged
    });

    it("does extend if new hold is longer", async () => {
      await extendThinking(SID, { hold: 30 });
      const hold1 = _getHoldUntilForTest(SID);

      await extendThinking(SID, { hold: 120 });
      const hold2 = _getHoldUntilForTest(SID);
      expect(hold2).toBeGreaterThan(hold1);
    });

    it("returns ok: false when resolveChat fails", async () => {
      mocks.resolveChat.mockReturnValue({ code: "UNAUTHORIZED_CHAT", message: "no chat" });
      const result = await extendThinking(SID, { label: "Working…" });
      expect(result.ok).toBe(false);
    });

    it("cycles phases via timer", async () => {
      const phases = ["Phase A", "Phase B", "Phase C"];
      await extendThinking(SID, { phases, hold: 60 });

      // Initial call with first phase
      expect(mocks.sendMessageDraft).toHaveBeenCalledWith(100, expect.any(Number), "Phase A");
      mocks.sendMessageDraft.mockClear();

      // Advance timer by 8s (PHASE_CYCLE_MS) to trigger cycle
      await vi.advanceTimersByTimeAsync(8100);
      expect(mocks.sendMessageDraft).toHaveBeenCalledWith(100, expect.any(Number), "Phase B");
      mocks.sendMessageDraft.mockClear();

      // Another cycle
      await vi.advanceTimersByTimeAsync(8100);
      expect(mocks.sendMessageDraft).toHaveBeenCalledWith(100, expect.any(Number), "Phase C");
    });
  });

  // ── AC6: closeThinking ──────────────────────────────────────────────────

  describe("closeThinking", () => {
    it("deactivates thinking", async () => {
      await onActionableDequeue(SID);
      const result = closeThinking(SID);
      expect(result.ok).toBe(true);
      expect(isThinkingActive(SID)).toBe(false);
    });

    it("is a no-op when thinking is not active", () => {
      const result = closeThinking(SID);
      expect(result.ok).toBe(true);
      expect(isThinkingActive(SID)).toBe(false);
    });
  });

  // ── AC7: removeThinkingState cleanup ────────────────────────────────────

  describe("removeThinkingState", () => {
    it("cleans up state for a session", async () => {
      await onActionableDequeue(SID);
      removeThinkingState(SID);
      expect(isThinkingActive(SID)).toBe(false);
      expect(_getHoldUntilForTest(SID)).toBe(0);
    });
  });

  // ── AC8: Refresh timer fires for extended hold ───────────────────────────

  describe("refresh timer (hold > 30s)", () => {
    it("re-fires draft before hold expires when hold > 30s", async () => {
      await extendThinking(SID, { hold: 60 });
      expect(mocks.sendMessageDraft).toHaveBeenCalledTimes(1);
      mocks.sendMessageDraft.mockClear();

      // Advance to ~26s (buffer fires at 60s - 4s = 56s from now)
      await vi.advanceTimersByTimeAsync(56100);
      expect(mocks.sendMessageDraft).toHaveBeenCalledOnce();
    });

    it("does NOT fire refresh timer for default 30s hold", async () => {
      await onActionableDequeue(SID);
      mocks.sendMessageDraft.mockClear();

      // Advance 26s (no refresh should fire for 30s-hold)
      await vi.advanceTimersByTimeAsync(26000);
      expect(mocks.sendMessageDraft).not.toHaveBeenCalled();
    });

    it("stops refresh timer after cancel", async () => {
      await extendThinking(SID, { hold: 120 });
      mocks.sendMessageDraft.mockClear();

      cancelThinkingForSid(SID);

      // Advance past when refresh would have fired
      await vi.advanceTimersByTimeAsync(120000);
      expect(mocks.sendMessageDraft).not.toHaveBeenCalled();
    });
  });

  // ── AC9: Per-session isolation ───────────────────────────────────────────

  describe("per-session isolation", () => {
    const SID_A = 10;
    const SID_B = 20;

    it("cancelling one session does not affect another", async () => {
      await onActionableDequeue(SID_A);
      await onActionableDequeue(SID_B);

      cancelThinkingForSid(SID_A);

      expect(isThinkingActive(SID_A)).toBe(false);
      expect(isThinkingActive(SID_B)).toBe(true);

      cancelThinkingForSid(SID_B);
    });

    it("hold-until is tracked independently per session", async () => {
      await onActionableDequeue(SID_A);

      // Advance 20s
      vi.advanceTimersByTime(20000);
      await onActionableDequeue(SID_B);

      const holdA = _getHoldUntilForTest(SID_A);
      const holdB = _getHoldUntilForTest(SID_B);
      // B was started 20s later so B's hold-until should be > A's
      expect(holdB).toBeGreaterThanOrEqual(holdA + 19000);

      cancelThinkingForSid(SID_A);
      cancelThinkingForSid(SID_B);
    });
  });
});
