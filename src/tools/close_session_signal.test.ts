import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseResult, isError, errorCode } from "./test-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// session/close/signal action handler tests
//
// The handler is not registered as a standalone MCP tool — it is invoked
// directly via the action dispatcher. Tests call handleCloseSessionSignal()
// directly with mocked collaborators.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn<(token: number | undefined) => number | { code: string; message: string }>(),
  getGovernorSid: vi.fn<() => number>(),
  getSession: vi.fn<(sid: number) => undefined | { sid?: number; name?: string; createdAt?: string }>(),
  deliverServiceMessage: vi.fn<(sid: number, text: string, eventType: string) => boolean>(),
  notifySessionWaiters: vi.fn<() => void>(),
  closeSessionById: vi.fn<(sid: number) => { closed: boolean; sid: number }>(),
  refreshGovernorCommand: vi.fn<() => Promise<void>>(),
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

vi.mock("../session-manager.js", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
  notifySessionWaiters: mocks.notifySessionWaiters,
}));

vi.mock("../session-teardown.js", () => ({
  closeSessionById: mocks.closeSessionById,
}));

vi.mock("../built-in-commands.js", () => ({
  refreshGovernorCommand: mocks.refreshGovernorCommand,
}));

import { handleCloseSessionSignal } from "./close_session_signal.js";

const GOVERNOR_SID = 1;
const GOVERNOR_TOKEN = 1_000_000;
const TARGET_SID = 2;

describe("session/close/signal action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.requireAuth.mockReturnValue(GOVERNOR_SID);
    mocks.getGovernorSid.mockReturnValue(GOVERNOR_SID);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === TARGET_SID) return { name: "Worker", createdAt: "2026-04-18" };
      return undefined;
    });
    mocks.deliverServiceMessage.mockReturnValue(true);
    mocks.notifySessionWaiters.mockReturnValue(undefined);
    mocks.closeSessionById.mockReturnValue({ closed: true, sid: TARGET_SID });
    mocks.refreshGovernorCommand.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Permission gating
  // ──────────────────────────────────────────────────────────────────────────

  it("returns PERMISSION_DENIED when caller is not the governor", async () => {
    mocks.requireAuth.mockReturnValue(5); // caller SID 5
    mocks.getGovernorSid.mockReturnValue(1); // governor is SID 1

    const result = await handleCloseSessionSignal({
      token: 5_000_000,
      target_sid: TARGET_SID,
      timeout_seconds: 1,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("PERMISSION_DENIED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("returns AUTH error when requireAuth fails", async () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });

    const result = await handleCloseSessionSignal({
      token: 9_999_999,
      target_sid: TARGET_SID,
      timeout_seconds: 1,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Target validation
  // ──────────────────────────────────────────────────────────────────────────

  it("rejects self-target with INVALID_TARGET", async () => {
    const result = await handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: GOVERNOR_SID, // same as caller
      timeout_seconds: 1,
    });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("INVALID_TARGET");
    expect(String(parsed.message)).toContain("session/close");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("returns SESSION_NOT_FOUND for an unknown target_sid", async () => {
    mocks.getSession.mockReturnValue(undefined); // target does not exist

    const result = await handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: 99,
      timeout_seconds: 1,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SESSION_NOT_FOUND");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Signal delivery
  // ──────────────────────────────────────────────────────────────────────────

  it("delivers a session_close_signal service message to the target", async () => {
    // Target self-closes immediately on next poll so we do not have to spin
    // the timer the full timeout.
    let firstLookup = true;
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid !== TARGET_SID) return undefined;
      if (firstLookup) {
        firstLookup = false;
        return { name: "Worker", createdAt: "2026-04-18" };
      }
      return undefined; // target has self-closed
    });

    const promise = handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: TARGET_SID,
      timeout_seconds: 1,
    });
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(isError(result)).toBe(false);
    expect(mocks.deliverServiceMessage).toHaveBeenCalledTimes(1);
    const [sid, text, eventType] = mocks.deliverServiceMessage.mock.calls[0];
    expect(sid).toBe(TARGET_SID);
    expect(eventType).toBe("session_close_signal");
    expect(String(text)).toContain("Governor");
    expect(String(text)).toContain("session/close");
    expect(mocks.notifySessionWaiters).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Self-close within timeout
  // ──────────────────────────────────────────────────────────────────────────

  it("returns self_closed and does not force-close when target closes within timeout", async () => {
    let firstLookup = true;
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid !== TARGET_SID) return undefined;
      if (firstLookup) {
        firstLookup = false;
        return { name: "Worker", createdAt: "2026-04-18" };
      }
      return undefined;
    });

    const promise = handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: TARGET_SID,
      timeout_seconds: 5,
    });
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.signaled).toBe(true);
    expect(parsed.closed).toBe(true);
    expect(parsed.sid).toBe(TARGET_SID);
    expect(parsed.reason).toBe("self_closed");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
    expect(mocks.refreshGovernorCommand).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Governor-change mid-wait
  // ──────────────────────────────────────────────────────────────────────────

  it("returns PERMISSION_DENIED if governor changes during the wait (target still alive)", async () => {
    // Target stays alive for the whole wait; governor changes before the
    // post-wait re-check fires.
    mocks.getSession.mockReturnValue({ name: "Worker", createdAt: "2026-04-18" });
    mocks.getGovernorSid
      .mockReturnValueOnce(GOVERNOR_SID) // initial governor check
      .mockReturnValue(99); // changed by the time we re-check

    const promise = handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: TARGET_SID,
      timeout_seconds: 1,
    });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("PERMISSION_DENIED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Force-close on timeout expiry
  // ──────────────────────────────────────────────────────────────────────────

  it("force-closes the target via closeSessionById when timeout expires", async () => {
    // Target stays alive; governor is still the caller when re-checked.
    mocks.getSession.mockReturnValue({ name: "Worker", createdAt: "2026-04-18" });
    mocks.getGovernorSid.mockReturnValue(GOVERNOR_SID);
    mocks.closeSessionById.mockReturnValue({ closed: true, sid: TARGET_SID });

    const promise = handleCloseSessionSignal({
      token: GOVERNOR_TOKEN,
      target_sid: TARGET_SID,
      timeout_seconds: 1,
    });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.signaled).toBe(true);
    expect(parsed.closed).toBe(true);
    expect(parsed.sid).toBe(TARGET_SID);
    expect(parsed.reason).toBe("force_closed_after_timeout");
    expect(mocks.closeSessionById).toHaveBeenCalledWith(TARGET_SID);
    expect(mocks.refreshGovernorCommand).toHaveBeenCalledTimes(1);
  });
});
