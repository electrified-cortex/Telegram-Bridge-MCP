/**
 * Tests for the kick-lockout gate (task impl-kick-lockout-2026-05-17).
 *
 * Covers ACs 1-10 from the spec:
 *  AC1. Cold-start kick fires immediately (no lockout)
 *  AC2. Burst single-kick: N messages in lockout window → exactly one mtime change
 *  AC3. Stale-lockout safety net: after LOCKOUT_MS expiry, next inbound fires again
 *  AC4. Post-content-DQ snap: releaseNotifyLockout clears lockout → next inbound fires
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
  getnotifyLockoutMs: vi.fn((_sid: number): number => 300_000),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _v: number): void => {}),
}));

vi.mock("../../session-manager.js", () => ({
  getnotifyLockoutMs: (sid: number) => sessionMocks.getnotifyLockoutMs(sid),
  getDequeueDefault: (sid: number) => sessionMocks.getDequeueDefault(sid),
  setDequeueDefault: (sid: number, v: number) => { sessionMocks.setDequeueDefault(sid, v); },
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
  notifyIfAllowed,
  setDequeueActive,
  releaseNotifyLockout,
  resetNotifyGateState,
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
    notifyLockedUntil: null,
    notifyPendingBecauseLocked: false,
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
    sessionMocks.getnotifyLockoutMs.mockReturnValue(LOCKOUT_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC 1: Cold-start kick ──────────────────────────────────────────────────
  it("AC1: fresh session, operator message → kick fires immediately", () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);

    const entry = getActivityFile(SID)!;
    expect(entry.touchInFlight).toBe(true);              // async touch in progress
    expect(entry.notifyLockedUntil).not.toBeNull();         // lockout set
    expect(entry.notifyPendingBecauseLocked).toBe(false);   // no suppression
  });

  it("AC1: appendFile is called on first kick", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── AC 2: Burst single-kick ────────────────────────────────────────────────
  it("AC2: 10 messages during lockout → exactly one appendFile call", async () => {
    setActivityFile(SID, makeState());

    // First kick sets lockout
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    const entry = getActivityFile(SID)!;
    expect(entry.notifyLockedUntil).not.toBeNull(); // lockout active

    // 9 more messages during lockout — all suppressed
    for (let i = 0; i < 9; i++) {
      notifyIfAllowed(SID, "operator", false);
    }
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1); // still just 1
    expect(getActivityFile(SID)!.notifyPendingBecauseLocked).toBe(true);
  });

  // ── AC 3: Stale-lockout safety net ────────────────────────────────────────
  it("AC3: after LOCKOUT_MS expires, next inbound fires another kick", async () => {
    sessionMocks.getnotifyLockoutMs.mockReturnValue(5_000); // short lockout for test
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Advance past lockout
    vi.advanceTimersByTime(6_000);

    // Next inbound should fire a fresh kick (lockout expired)
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 4: Post-content-DQ snap ────────────────────────────────────────────
  it("AC4: releaseNotifyLockout clears lockout; next inbound kicks immediately", async () => {
    sessionMocks.getnotifyLockoutMs.mockReturnValue(5_000);
    setActivityFile(SID, makeState());

    // Set lockout via first kick
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.notifyLockedUntil).not.toBeNull();

    // Content-returning dequeue releases lockout
    releaseNotifyLockout(SID);
    expect(getActivityFile(SID)!.notifyLockedUntil).toBeNull();

    // Next inbound should kick immediately (lockout cleared)
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 5: Suppressed-during-lockout re-evaluation ─────────────────────────
  it("AC5: kick fires for M1; M2 suppressed; after dequeue → re-eval kick fires", async () => {
    setActivityFile(SID, makeState());

    // M1 kick
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // M2 suppressed during lockout
    notifyIfAllowed(SID, "operator", false);
    expect(getActivityFile(SID)!.notifyPendingBecauseLocked).toBe(true);

    // Agent dequeues (content-returning) → lockout releases → re-eval kick fires
    queueMocks.hasPendingUserContent.mockReturnValue(true); // M2 still in queue
    releaseNotifyLockout(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Re-evaluation kick should have fired
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
    expect(getActivityFile(SID)!.notifyPendingBecauseLocked).toBe(false);
  });

  it("AC5: if queue drained before lockout release → no spurious re-eval kick", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    notifyIfAllowed(SID, "operator", false); // suppressed
    expect(getActivityFile(SID)!.notifyPendingBecauseLocked).toBe(true);

    // Queue is now empty (agent dequeued everything)
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyLockout(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // No re-eval kick — queue was empty
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  // ── AC 6: Lockout release is opt-in — setDequeueActive alone does not clear it ──
  // NOTE (BT-2301): dequeue.ts now calls releaseNotifyLockout on ALL exit paths
  // (content-returning AND timeout). The unit invariant below still holds:
  // setDequeueActive(false) alone does NOT release the lockout — only
  // releaseNotifyLockout() does. The integration test for the new timeout-exit
  // behavior lives in src/tools/dequeue.test.ts ("timeout-exit lockout release").
  it("AC6: setDequeueActive(false) alone does NOT release kick lockout", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    const lockedUntil = getActivityFile(SID)!.notifyLockedUntil;
    expect(lockedUntil).not.toBeNull();

    // setDequeueActive cycle without calling releaseNotifyLockout
    setDequeueActive(SID, true);
    setDequeueActive(SID, false);
    // releaseNotifyLockout NOT called

    // Lockout must still be active — only releaseNotifyLockout() clears it
    expect(getActivityFile(SID)!.notifyLockedUntil).toBe(lockedUntil);
  });

  it("AC6: releaseNotifyLockout clears lockout (timeout-exit path now calls it — BT-2301)", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(getActivityFile(SID)!.notifyLockedUntil).not.toBeNull();

    // Simulate the new timeout-exit behavior: dequeue.ts now sets _lockoutRelease=true
    // on timeout exits, so the finally block calls releaseNotifyLockout.
    releaseNotifyLockout(SID);

    // Lockout is cleared — a subsequent kick from a reminder will not be suppressed
    expect(getActivityFile(SID)!.notifyLockedUntil).toBeNull();
  });

  it("AC6: message arriving during lockout while agent polls → no additional kick", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Operator sends during lockout
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Still exactly one kick
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.notifyPendingBecauseLocked).toBe(true);
  });

  // ── AC 7: In-flight dequeue suppresses kicks ───────────────────────────────
  it("AC7: operator message during inflight dequeue → zero appendFile calls", async () => {
    setActivityFile(SID, makeState({ inflightDequeue: true }));

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    // Lockout should NOT be set (kick was suppressed by inflightDequeue check)
    expect(getActivityFile(SID)!.notifyLockedUntil).toBeNull();
  });

  it("AC7: after dequeue ends (setDequeueActive false), next inbound fires kick", async () => {
    setActivityFile(SID, makeState({ inflightDequeue: true }));

    notifyIfAllowed(SID, "operator", false); // suppressed — inflight
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();

    setDequeueActive(SID, false);

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── AC 8: Touch failure rollback ──────────────────────────────────────────
  it("AC8: appendFile fails → lockout NOT set; next inbound retries", async () => {
    vi.mocked(appendFile).mockRejectedValueOnce(
      Object.assign(new Error("EPERM"), { code: "EPERM" }),
    );
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entry = getActivityFile(SID)!;
    // Lockout should be rolled back after failure
    expect(entry.notifyLockedUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
    // pendingRetryHandle should be set (retry scheduled)
    expect(entry.pendingRetryHandle).not.toBeNull();
  });

  it("AC8: retry succeeds → lockout is set after successful retry", async () => {
    vi.mocked(appendFile)
      .mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }))
      .mockResolvedValue(undefined); // retry succeeds

    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve(); // first attempt fails, retry scheduled

    const entryAfterFail = getActivityFile(SID)!;
    expect(entryAfterFail.notifyLockedUntil).toBeNull();
    expect(entryAfterFail.pendingRetryHandle).not.toBeNull();

    // Fire the retry timer (1s delay)
    vi.advanceTimersByTime(1_100);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entryAfterRetry = getActivityFile(SID)!;
    expect(entryAfterRetry.notifyLockedUntil).not.toBeNull(); // set after retry success
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 9: Source classification ───────────────────────────────────────────
  it("AC9: service message during inflight dequeue (inflightAtEnqueue=true) → no kick", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "service", true); // inflightAtEnqueue=true
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    expect(getActivityFile(SID)!.notifyLockedUntil).toBeNull();
  });

  it("AC9: service message to idle session (inflightAtEnqueue=false) → kick fires", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "service", false); // inflightAtEnqueue=false → idle session
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: reminder to idle session → kick fires", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "reminder", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: bridge-internal event → no kick regardless of inflightAtEnqueue", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "bridge-internal", false);
    notifyIfAllowed(SID, "bridge-internal", true);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  // ── AC 10: Reconnect resets state ─────────────────────────────────────────
  it("AC10: resetNotifyGateState clears lockout mid-lockout", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(getActivityFile(SID)!.notifyLockedUntil).not.toBeNull();

    resetNotifyGateState(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.notifyLockedUntil).toBeNull();
    expect(entry.notifyPendingBecauseLocked).toBe(false);
    expect(entry.touchInFlight).toBe(false);
  });

  it("AC10: next inbound after resetNotifyGateState triggers immediate kick", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    vi.mocked(appendFile).mockClear();

    resetNotifyGateState(SID);
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── handleSessionStopped ──────────────────────────────────────────────────
  it("handleSessionStopped: returns noOp when no file registered", () => {
    const result = handleSessionStopped(SID);
    expect(result.noOp).toBe(true);
  });

  it("handleSessionStopped: resets gate and kicks if queue has pending", async () => {
    setActivityFile(SID, makeState({ notifyLockedUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(true);

    const result = handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(result.noOp).toBe(false);
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("handleSessionStopped: resets gate but does NOT kick if queue empty", async () => {
    setActivityFile(SID, makeState({ notifyLockedUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    const entry = getActivityFile(SID)!;
    expect(entry.notifyLockedUntil).toBeNull(); // reset, not kicked
  });

  // ── replaceActivityFile ────────────────────────────────────────────────────
  it("replaceActivityFile: carries over gate state from old entry", async () => {
    const oldState = makeState({ notifyLockedUntil: Date.now() + 300_000 });
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file" });
    await replaceActivityFile(SID, newState);

    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.notifyLockedUntil).toBe(oldState.notifyLockedUntil); // carried over
  });

  it("replaceActivityFile: concurrent notifyIfAllowed reaches new entry", async () => {
    const oldState = makeState({ notifyLockedUntil: null }); // no lockout
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file", notifyLockedUntil: null });
    const replacePromise = replaceActivityFile(SID, newState);

    // Touch fires while replace is still awaiting cleanup
    notifyIfAllowed(SID, "operator", false);

    await replacePromise;
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // newState should have been kicked
    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.notifyLockedUntil).not.toBeNull();
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
    sessionMocks.getnotifyLockoutMs.mockReturnValue(LOCKOUT_MS);
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
    sessionMocks.getnotifyLockoutMs.mockReturnValue(LOCKOUT_MS);
  });

  afterEach(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

  it("emits console.warn and recreates the file on ENOENT", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);

    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);

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
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/file missing — recreating/);
    expect(vi.mocked(console.warn).mock.calls[1][0]).toMatch(/recreation failed/);
  });

  it("no warn, single appendFile call when file exists (normal touch)", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).not.toHaveBeenCalled();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  it("ENOENT recovery: lockout is rolled back when recreation fails", async () => {
    const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("EPERM"));

    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Touch ultimately failed → lockout must be rolled back
    const entry = getActivityFile(SID)!;
    expect(entry.notifyLockedUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
  });
});
