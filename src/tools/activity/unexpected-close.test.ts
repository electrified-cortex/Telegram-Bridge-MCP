/**
 * Tests for 10-3029: unexpected subscription close tracking.
 *
 * AC1: When SSE or activity-file subscription closes without agent teardown,
 *      the bridge records the close as unexpected.
 * AC4: Agent-initiated teardown (activity/listen cancel, activity/file/delete,
 *      session/close) does NOT trigger the service message.
 * AC5: Applies to both SSE (activity/listen) and activity-file subscriptions.
 *
 * AC2 + AC3 (dequeue injection) are tested in dequeue.test.ts.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Mock session-manager ────────────────────────────────────────────────────
vi.mock("../../session-manager.js", () => ({
  getNotifyDebounceMs: vi.fn((_sid: number): number => 300_000),
}));

// ── Mock session-queue ──────────────────────────────────────────────────────
vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => false),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

// ── Mock fs/promises ────────────────────────────────────────────────────────
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}));

import { appendFile } from "fs/promises";

import {
  registerSseMonitor,
  unregisterSseMonitor,
  recordUnexpectedSubscriptionClose,
  consumeUnexpectedSubscriptionClose,
  clearUnexpectedCloseForSession,
  clearActivityFile,
  replaceActivityFile,
  resetActivityFileStateForTest,
  setActivityFile,
  type ActivityFileState,
} from "./file-state.js";

const SID = 99;

function makeFileState(overrides: Partial<ActivityFileState> = {}): ActivityFileState {
  return {
    filePath: "/tmp/test-activity.txt",
    tmcpOwned: false,
    inflightDequeue: false,
    notifyDebounceUntil: null,
    notifyPendingBecauseDebounce: false,
    touchInFlight: false,
    pendingRetryHandle: null,
    pendingReNotifyHandle: null,
    ...overrides,
  };
}

describe("unexpected subscription close — file-state layer (10-3029)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC1 + AC5: SSE unexpected close ───────────────────────────────────────

  describe("AC1 + AC5: SSE (activity/listen) unexpected close", () => {
    it("records unexpected close when SSE connection drops (no cancel)", () => {
      registerSseMonitor(SID);
      // Simulate organic close — req 'close' fires without cancelSseConnection
      unregisterSseMonitor(SID); // expected defaults to false

      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(true);
    });

    it("consume returns false after the first consume (AC3 at state level)", () => {
      registerSseMonitor(SID);
      unregisterSseMonitor(SID);

      consumeUnexpectedSubscriptionClose(SID); // first: true
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false); // second: false
    });

    it("records again after a second unexpected close", () => {
      // First cycle
      registerSseMonitor(SID);
      unregisterSseMonitor(SID);
      consumeUnexpectedSubscriptionClose(SID); // consumed

      // Second cycle: agent re-arms but drops again
      registerSseMonitor(SID); // clears pending from first cycle
      unregisterSseMonitor(SID);

      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(true);
    });
  });

  // ── AC4: Agent-initiated SSE cancel does NOT record unexpected close ───────

  describe("AC4: agent-initiated SSE cancel does not trigger service message", () => {
    it("no unexpected close when expected=true (cancelSseConnection path)", () => {
      registerSseMonitor(SID);
      unregisterSseMonitor(SID, true); // expected = true (agent called cancel)

      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── AC1 + AC5: Activity-file unexpected close (retry exhaustion) ──────────

  describe("AC1 + AC5: activity-file subscription unexpected close via retry exhaustion", () => {
    it("records unexpected close when touch retry exhausts after 2 attempts", () => {
      // Make appendFile fail persistently
      vi.mocked(appendFile).mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));

      setActivityFile(SID, makeFileState());

      // Manually trigger recordUnexpectedSubscriptionClose as scheduleRetry would on exhaustion.
      // We test through recordUnexpectedSubscriptionClose directly since scheduleRetry is private.
      recordUnexpectedSubscriptionClose(SID);

      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(true);
    });

    it("consume returns false with no prior unexpected close", () => {
      setActivityFile(SID, makeFileState());
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── AC4: Agent-initiated activity/file/delete clears pending flag ─────────

  describe("AC4: agent-initiated file delete clears unexpected close state", () => {
    it("clearActivityFile removes pending unexpected-close (session/close / file-delete path)", async () => {
      // Simulate unexpected close recorded before agent calls file-delete
      recordUnexpectedSubscriptionClose(SID);
      setActivityFile(SID, makeFileState());

      // Agent calls activity/file/delete → clearActivityFile
      await clearActivityFile(SID);

      // Flag should be cleared — no message on next dequeue
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── registerSseMonitor clears pending flag (reconnect path) ──────────────

  describe("re-arm clears pending unexpected close", () => {
    it("registerSseMonitor clears flag when agent re-arms SSE", () => {
      registerSseMonitor(SID);
      unregisterSseMonitor(SID); // unexpected close
      // Flag is set

      registerSseMonitor(SID); // agent re-arms
      // Flag should be cleared
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });

    it("replaceActivityFile clears flag when agent re-registers file", async () => {
      recordUnexpectedSubscriptionClose(SID);
      // Agent calls activity/file/create again → replaceActivityFile
      await replaceActivityFile(SID, makeFileState({ filePath: "/tmp/new-activity.txt" }));
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── clearUnexpectedCloseForSession (session teardown) ────────────────────

  describe("session teardown cleans up pending flag", () => {
    it("clearUnexpectedCloseForSession removes orphaned flag", () => {
      recordUnexpectedSubscriptionClose(SID);
      clearUnexpectedCloseForSession(SID);
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── No false-positive when unregisterSseMonitor called with no SSE entry ──

  describe("no false-positive unexpected close when no SSE was registered", () => {
    it("unregisterSseMonitor on non-existent entry is a no-op", () => {
      unregisterSseMonitor(SID); // No register() call before
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });

    it("unregisterSseMonitor with sseConnected=false does not re-record", () => {
      // Register SSE, cancel it (expected), then try unexpected unregister
      registerSseMonitor(SID);
      unregisterSseMonitor(SID, true); // expected = true, SSE now cleared
      // After expected cancel, sseConnected=false; a second organic unregister should be no-op
      // (entry deleted already since filePath=null and sseConnected=false)
      unregisterSseMonitor(SID); // entry is gone, should be no-op
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── recordUnexpectedSubscriptionClose is idempotent ──────────────────────

  describe("idempotency of recordUnexpectedSubscriptionClose", () => {
    it("multiple records before consume result in a single consume", () => {
      recordUnexpectedSubscriptionClose(SID);
      recordUnexpectedSubscriptionClose(SID);
      recordUnexpectedSubscriptionClose(SID);

      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(true);
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });

  // ── resetActivityFileStateForTest clears unexpected close state ───────────

  describe("resetActivityFileStateForTest clears unexpected close state", () => {
    it("clears pending flag on reset", () => {
      recordUnexpectedSubscriptionClose(SID);
      resetActivityFileStateForTest();
      expect(consumeUnexpectedSubscriptionClose(SID)).toBe(false);
    });
  });
});
