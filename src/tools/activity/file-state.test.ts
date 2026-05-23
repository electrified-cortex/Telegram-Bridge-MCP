/**
 * Tests for the kick-lockout gate (task impl-kick-lockout-2026-05-17).
 *
 * Covers ACs 1-10 from the spec:
 *  AC1. Cold-start kick fires immediately (no lockout)
 *  AC2. Burst single-kick: N messages in lockout window → exactly one mtime change
 *  AC3. Stale-lockout safety net: after LOCKOUT_MS expiry, next inbound fires again
 *  AC4. Post-content-DQ snap: releaseKickLockout clears lockout → next inbound fires
 *  AC5. Suppressed-during-lockout re-evaluation fires after lockout release
 *  AC6. Polling agent (timeout dequeue) does NOT release kick lockout
 *  AC7. In-flight dequeue suppresses kicks (agent reads inline)
 *  AC8. Touch failure rollback: lockout NOT set when touch fails
 *  AC9. Source classification: service during inflight=no-kick; reminder=kick
 * AC10. Reconnect resets kick gate; next inbound fires immediately
 *
 * Also keeps:
 *  - activity/file/create ALREADY_REGISTERED guard (AC7 from prior task)
 *  - appendNewline ENOENT recovery
 *  - replaceActivityFile atomic swap and generation check
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock session-gate
const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 42),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

// Mock session-manager
const sessionMocks = vi.hoisted(() => ({
  getKickLockoutMs: vi.fn((_sid: number): number => 300_000),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _v: number): void => {}),
}));

vi.mock("../../session-manager.js", () => ({
  getKickLockoutMs: (sid: number) => sessionMocks.getKickLockoutMs(sid),
  getDequeueDefault: (sid: number) => sessionMocks.getDequeueDefault(sid),
  setDequeueDefault: (sid: number, v: number) => sessionMocks.setDequeueDefault(sid, v),
}));

// Mock session-queue
const queueMocks = vi.hoisted(() => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => true),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: (sid: number) => queueMocks.hasPendingUserContent(sid),
  deliverServiceMessage: (...args: unknown[]) => queueMocks.deliverServiceMessage(...args),
}));

// Mock fs/promises to avoid real file I/O
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}));

import { appendFile, mkdir, open } from "fs/promises";

import {
  setActivityFile,
  getActivityFile,
  kickIfAllowed,
  setDequeueActive,
  releaseKickLockout,
  resetKickGateState,
  handleSessionStopped,
  replaceActivityFile,
  resetActivityFileStateForTest,
  type ActivityFileState,
} from "./file-state.js";

import { handleActivityFileCreate } from "./create.js";
import { handleActivityFileEdit } from "./edit.js";

const SID = 42;
const LOCKOUT_MS = 300_000;

function makeState(overrides: Partial<ActivityFileState> = {}): ActivityFileState {
  return {
    filePath: "/tmp/test-activity-file",
    tmcpOwned: false,
    inflightDequeue: false,
    kickLockedUntil: null,
    kickPendingBecauseLocked: false,
    touchInFlight: false,
    pendingRetryHandle: null,
    ...overrides,
  };
}

describe("kick-lockout gate — ACs 1-10", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getKickLockoutMs.mockReturnValue(LOCKOUT_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC 1: Cold-start kick ──────────────────────────────────────────────────
  it("AC1: fresh session, operator message → kick fires immediately", () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);

    const entry = getActivityFile(SID)!;
    expect(entry.touchInFlight).toBe(true);              // async touch in progress
    expect(entry.kickLockedUntil).not.toBeNull();         // lockout set
    expect(entry.kickPendingBecauseLocked).toBe(false);   // no suppression
  });

  it("AC1: appendFile is called on first kick", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── AC 2: Burst single-kick ────────────────────────────────────────────────
  it("AC2: 10 messages during lockout → exactly one appendFile call", async () => {
    setActivityFile(SID, makeState());

    // First kick sets lockout
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    const entry = getActivityFile(SID)!;
    expect(entry.kickLockedUntil).not.toBeNull(); // lockout active

    // 9 more messages during lockout — all suppressed
    for (let i = 0; i < 9; i++) {
      kickIfAllowed(SID, "operator", false);
    }
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1); // still just 1
    expect(getActivityFile(SID)!.kickPendingBecauseLocked).toBe(true);
  });

  // ── AC 3: Stale-lockout safety net ────────────────────────────────────────
  it("AC3: after LOCKOUT_MS expires, next inbound fires another kick", async () => {
    sessionMocks.getKickLockoutMs.mockReturnValue(5_000); // short lockout for test
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Advance past lockout
    vi.advanceTimersByTime(6_000);

    // Next inbound should fire a fresh kick (lockout expired)
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 4: Post-content-DQ snap ────────────────────────────────────────────
  it("AC4: releaseKickLockout clears lockout; next inbound kicks immediately", async () => {
    sessionMocks.getKickLockoutMs.mockReturnValue(5_000);
    setActivityFile(SID, makeState());

    // Set lockout via first kick
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.kickLockedUntil).not.toBeNull();

    // Content-returning dequeue releases lockout
    releaseKickLockout(SID);
    expect(getActivityFile(SID)!.kickLockedUntil).toBeNull();

    // Next inbound should kick immediately (lockout cleared)
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 5: Suppressed-during-lockout re-evaluation ─────────────────────────
  it("AC5: kick fires for M1; M2 suppressed; after dequeue → re-eval kick fires", async () => {
    setActivityFile(SID, makeState());

    // M1 kick
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // M2 suppressed during lockout
    kickIfAllowed(SID, "operator", false);
    expect(getActivityFile(SID)!.kickPendingBecauseLocked).toBe(true);

    // Agent dequeues (content-returning) → lockout releases → re-eval kick fires
    queueMocks.hasPendingUserContent.mockReturnValue(true); // M2 still in queue
    releaseKickLockout(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Re-evaluation kick should have fired
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
    expect(getActivityFile(SID)!.kickPendingBecauseLocked).toBe(false);
  });

  it("AC5: if queue drained before lockout release → no spurious re-eval kick", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    kickIfAllowed(SID, "operator", false); // suppressed
    expect(getActivityFile(SID)!.kickPendingBecauseLocked).toBe(true);

    // Queue is now empty (agent dequeued everything)
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseKickLockout(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // No re-eval kick — queue was empty
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  // ── AC 6: Polling agent (timeout dequeue) doesn't release lockout ─────────
  it("AC6: timeout-only dequeue exits do NOT release kick lockout", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    const lockedUntil = getActivityFile(SID)!.kickLockedUntil;
    expect(lockedUntil).not.toBeNull();

    // Simulate timeout dequeue (setDequeueActive without releaseKickLockout)
    setDequeueActive(SID, true);
    setDequeueActive(SID, false);
    // releaseKickLockout NOT called (timeout path)

    // Lockout should still be active
    expect(getActivityFile(SID)!.kickLockedUntil).toBe(lockedUntil);
  });

  it("AC6: message arriving during lockout while agent polls → no additional kick", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Operator sends during lockout
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Still exactly one kick
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.kickPendingBecauseLocked).toBe(true);
  });

  // ── AC 7: In-flight dequeue suppresses kicks ───────────────────────────────
  it("AC7: operator message during inflight dequeue → zero appendFile calls", async () => {
    setActivityFile(SID, makeState({ inflightDequeue: true }));

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    // Lockout should NOT be set (kick was suppressed by inflightDequeue check)
    expect(getActivityFile(SID)!.kickLockedUntil).toBeNull();
  });

  it("AC7: after dequeue ends (setDequeueActive false), next inbound fires kick", async () => {
    setActivityFile(SID, makeState({ inflightDequeue: true }));

    kickIfAllowed(SID, "operator", false); // suppressed — inflight
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();

    setDequeueActive(SID, false);

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── AC 8: Touch failure rollback ──────────────────────────────────────────
  it("AC8: appendFile fails → lockout NOT set; next inbound retries", async () => {
    vi.mocked(appendFile).mockRejectedValueOnce(
      Object.assign(new Error("EPERM"), { code: "EPERM" }),
    );
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entry = getActivityFile(SID)!;
    // Lockout should be rolled back after failure
    expect(entry.kickLockedUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
    // pendingRetryHandle should be set (retry scheduled)
    expect(entry.pendingRetryHandle).not.toBeNull();
  });

  it("AC8: retry succeeds → lockout is set after successful retry", async () => {
    vi.mocked(appendFile)
      .mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }))
      .mockResolvedValue(undefined); // retry succeeds

    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve(); // first attempt fails, retry scheduled

    const entryAfterFail = getActivityFile(SID)!;
    expect(entryAfterFail.kickLockedUntil).toBeNull();
    expect(entryAfterFail.pendingRetryHandle).not.toBeNull();

    // Fire the retry timer (1s delay)
    vi.advanceTimersByTime(1_100);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entryAfterRetry = getActivityFile(SID)!;
    expect(entryAfterRetry.kickLockedUntil).not.toBeNull(); // set after retry success
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 9: Source classification ───────────────────────────────────────────
  it("AC9: service message during inflight dequeue (inflightAtEnqueue=true) → no kick", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "service", true); // inflightAtEnqueue=true
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    expect(getActivityFile(SID)!.kickLockedUntil).toBeNull();
  });

  it("AC9: service message to idle session (inflightAtEnqueue=false) → kick fires", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "service", false); // inflightAtEnqueue=false → idle session
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: reminder to idle session → kick fires", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "reminder", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: bridge-internal event → no kick regardless of inflightAtEnqueue", async () => {
    setActivityFile(SID, makeState());

    kickIfAllowed(SID, "bridge-internal", false);
    kickIfAllowed(SID, "bridge-internal", true);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  // ── AC 10: Reconnect resets state ─────────────────────────────────────────
  it("AC10: resetKickGateState clears lockout mid-lockout", async () => {
    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(getActivityFile(SID)!.kickLockedUntil).not.toBeNull();

    resetKickGateState(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.kickLockedUntil).toBeNull();
    expect(entry.kickPendingBecauseLocked).toBe(false);
    expect(entry.touchInFlight).toBe(false);
  });

  it("AC10: next inbound after resetKickGateState triggers immediate kick", async () => {
    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    vi.mocked(appendFile).mockClear();

    resetKickGateState(SID);
    kickIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── handleSessionStopped ──────────────────────────────────────────────────
  it("handleSessionStopped: returns noOp when no file registered", () => {
    const result = handleSessionStopped(SID);
    expect(result.noOp).toBe(true);
  });

  it("handleSessionStopped: resets gate and kicks if queue has pending", async () => {
    setActivityFile(SID, makeState({ kickLockedUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(true);

    const result = handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(result.noOp).toBe(false);
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("handleSessionStopped: resets gate but does NOT kick if queue empty", async () => {
    setActivityFile(SID, makeState({ kickLockedUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    const entry = getActivityFile(SID)!;
    expect(entry.kickLockedUntil).toBeNull(); // reset, not kicked
  });

  // ── replaceActivityFile ────────────────────────────────────────────────────
  it("replaceActivityFile: carries over gate state from old entry", async () => {
    const oldState = makeState({ kickLockedUntil: Date.now() + 300_000 });
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file" });
    await replaceActivityFile(SID, newState);

    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.kickLockedUntil).toBe(oldState.kickLockedUntil); // carried over
  });

  it("replaceActivityFile: concurrent kickIfAllowed reaches new entry", async () => {
    const oldState = makeState({ kickLockedUntil: null }); // no lockout
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file", kickLockedUntil: null });
    const replacePromise = replaceActivityFile(SID, newState);

    // Touch fires while replace is still awaiting cleanup
    kickIfAllowed(SID, "operator", false);

    await replacePromise;
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // newState should have been kicked
    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.kickLockedUntil).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// activity/file/create — ALREADY_REGISTERED guard (preserved from prior task)
// ---------------------------------------------------------------------------

describe("activity/file/create — ALREADY_REGISTERED guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    sessionMocks.getKickLockoutMs.mockReturnValue(LOCKOUT_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC7a: first create succeeds and returns file_path", async () => {
    const result = await handleActivityFileCreate({ token: 99 });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.file_path).toBe("string");
  });

  it("AC7b: second create returns ALREADY_REGISTERED with details", async () => {
    await handleActivityFileCreate({ token: 99 });
    const result = await handleActivityFileCreate({ token: 99 });
    expect((result as { isError?: true }).isError).toBe(true);
    const err = JSON.parse(result.content[0].text);
    expect(err.code).toBe("ALREADY_REGISTERED");
    expect(typeof err.details.file_path).toBe("string");
    expect(typeof err.details.tmcp_owned).toBe("boolean");
  });

  it("AC7c: existing registration unchanged after failed create", async () => {
    const firstResult = await handleActivityFileCreate({ token: 99 });
    const firstPath = JSON.parse(firstResult.content[0].text).file_path;

    await handleActivityFileCreate({ token: 99 }); // second call — must fail

    const entry = getActivityFile(SID)!;
    expect(entry.filePath).toBe(firstPath);
    expect(entry.tmcpOwned).toBe(true);
  });

  it("AC7d: edit works after failed create", async () => {
    await handleActivityFileCreate({ token: 99 });
    await handleActivityFileCreate({ token: 99 }); // fails

    const editResult = await handleActivityFileEdit({ token: 99 });
    expect((editResult as { isError?: true }).isError).toBeUndefined();
    const data = JSON.parse(editResult.content[0].text);
    expect(typeof data.file_path).toBe("string");
    expect(typeof data.previous_path).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// appendNewline ENOENT recovery
// ---------------------------------------------------------------------------

describe("appendNewline ENOENT recovery", () => {
  beforeEach(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    sessionMocks.getKickLockoutMs.mockReturnValue(LOCKOUT_MS);
  });

  afterEach(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

  it("emits console.warn and recreates the file on ENOENT", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);

    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("file missing — recreating at registered path"),
    );
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(vi.mocked(open)).toHaveBeenCalledWith(makeState().filePath, "a", 0o600);
    // appendFile: 1 (ENOENT) + 1 retry after recreation = 2
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  it("emits second console.warn when recreation itself fails", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("EPERM: permission denied"));

    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/file missing — recreating/);
    expect(vi.mocked(console.warn).mock.calls[1][0]).toMatch(/recreation failed/);
  });

  it("no warn, single appendFile call when file exists (normal touch)", async () => {
    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).not.toHaveBeenCalled();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  it("ENOENT recovery: lockout is rolled back when recreation fails", async () => {
    const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("EPERM"));

    setActivityFile(SID, makeState());
    kickIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Touch ultimately failed → lockout must be rolled back
    const entry = getActivityFile(SID)!;
    expect(entry.kickLockedUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
  });
});
