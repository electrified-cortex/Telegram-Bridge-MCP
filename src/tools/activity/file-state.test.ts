/**
 * Tests for the notify-debounce gate (task impl-kick-lockout-2026-05-17).
 *
 * Covers ACs 1-10 from the spec:
 *  AC1. Cold-start notify fires immediately (no debounce)
 *  AC2. Burst single-notify: N messages in debounce window → exactly one mtime change
 *  AC3. Stale-debounce safety net: after DEBOUNCE_MS expiry, next inbound fires again
 *  AC4. Post-content-DQ snap: releaseNotifyDebounce clears debounce → next inbound fires
 *  AC5. Suppressed-during-debounce re-evaluation fires after debounce release
 *  AC6. Polling agent (timeout dequeue) does NOT release notify debounce
 *  AC7. In-flight dequeue suppresses notifications (agent reads inline)
 *  AC8. Touch failure rollback: debounce NOT set when touch fails
 *  AC9. Source classification: service during inflight=no-notify; reminder=notify
 * AC10. Reconnect resets notify gate; next inbound fires immediately
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
  getNotifyDebounceMs: vi.fn((_sid: number): number => 300_000),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _v: number): void => {}),
}));

vi.mock("../../session-manager.js", () => ({
  getNotifyDebounceMs: (sid: number) => sessionMocks.getNotifyDebounceMs(sid),
  getDequeueDefault: (sid: number) => sessionMocks.getDequeueDefault(sid),
  setDequeueDefault: (sid: number, v: number) => { sessionMocks.setDequeueDefault(sid, v); },
}));

// Mock session-queue
const queueMocks = vi.hoisted(() => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => true),
  hasPendingReminderContent: vi.fn((_sid: number): boolean => false),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: (sid: number) => queueMocks.hasPendingUserContent(sid),
  hasPendingReminderContent: (sid: number) => queueMocks.hasPendingReminderContent(sid),
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
  releaseNotifyDebounce,
  resetNotifyGateState,
  handleSessionStopped,
  replaceActivityFile,
  resetActivityFileStateForTest,
  initSseNotifyCallback,
  registerSseMonitor,
  unregisterSseMonitor,
  clearActivityFile,
  getFirstNotifyTimestamp,
  type ActivityFileState,
} from "./file-state.js";

import { handleActivityFileCreate } from "./create.js";
import { handleActivityFileEdit } from "./edit.js";

const SID = 42;
const DEBOUNCE_MS = 300_000;

function makeState(overrides: Partial<ActivityFileState> = {}): ActivityFileState {
  return {
    filePath: "/tmp/test-activity-file",
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

describe("notify-debounce gate — ACs 1-10", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC 1: Cold-start notify ───────────────────────────────────────────────
  it("AC1: fresh session, operator message → notify fires immediately", () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);

    const entry = getActivityFile(SID)!;
    expect(entry.touchInFlight).toBe(true);              // async touch in progress
    expect(entry.notifyDebounceUntil).not.toBeNull();         // debounce set
    expect(entry.notifyPendingBecauseDebounce).toBe(false);   // no suppression
  });

  it("AC1: appendFile is called on first notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  // ── AC 2: Burst single-notify ─────────────────────────────────────────────
  it("AC2: 10 messages during debounce → exactly one appendFile call", async () => {
    setActivityFile(SID, makeState());

    // First notify sets debounce
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    const entry = getActivityFile(SID)!;
    expect(entry.notifyDebounceUntil).not.toBeNull(); // debounce active

    // 9 more messages during debounce — all suppressed
    for (let i = 0; i < 9; i++) {
      notifyIfAllowed(SID, "operator", false);
    }
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1); // still just 1
    expect(getActivityFile(SID)!.notifyPendingBecauseDebounce).toBe(true);
  });

  // ── AC 3: Stale-debounce safety net ────────────────────────────────────────
  it("AC3: after DEBOUNCE_MS expires, next inbound fires another notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Advance past debounce (idle path = 300_000ms hardcoded)
    vi.advanceTimersByTime(DEBOUNCE_MS);

    // Next inbound should fire a fresh notify (debounce expired)
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 4: Post-content-DQ snap ────────────────────────────────────────────
  it("AC4: releaseNotifyDebounce clears debounce; next inbound notifies immediately", async () => {
    sessionMocks.getNotifyDebounceMs.mockReturnValue(5_000);
    setActivityFile(SID, makeState());

    // Set debounce via first notify
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.notifyDebounceUntil).not.toBeNull();

    // Content-returning dequeue releases debounce
    releaseNotifyDebounce(SID);
    expect(getActivityFile(SID)!.notifyDebounceUntil).toBeNull();

    // Next inbound should notify immediately (debounce cleared)
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 5: Suppressed-during-debounce re-evaluation ─────────────────────────
  it("AC5: notify fires for M1; M2 suppressed; after dequeue → re-eval notify fires", async () => {
    setActivityFile(SID, makeState());

    // M1 notify
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // M2 suppressed during debounce
    notifyIfAllowed(SID, "operator", false);
    expect(getActivityFile(SID)!.notifyPendingBecauseDebounce).toBe(true);

    // Agent dequeues (content-returning) → debounce releases → re-eval notify fires
    queueMocks.hasPendingUserContent.mockReturnValue(true); // M2 still in queue
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Re-evaluation notify should have fired
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
    expect(getActivityFile(SID)!.notifyPendingBecauseDebounce).toBe(false);
  });

  it("AC5: if queue drained before debounce release → no spurious re-eval notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    notifyIfAllowed(SID, "operator", false); // suppressed
    expect(getActivityFile(SID)!.notifyPendingBecauseDebounce).toBe(true);

    // Queue is now empty (agent dequeued everything)
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // No re-eval notify — queue was empty
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  // ── AC 6: Debounce release is opt-in — setDequeueActive alone does not clear it ──
  // NOTE: dequeue.ts calls releaseNotifyDebounce on ALL exit paths
  // (content-returning AND timeout). The unit invariant below still holds:
  // setDequeueActive(false) alone does NOT release the debounce — only
  // releaseNotifyDebounce() does. The integration test for the timeout-exit
  // behavior lives in src/tools/dequeue.test.ts ("timeout-exit debounce release").
  it("AC6: setDequeueActive(false) alone does NOT release notify debounce", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    const lockedUntil = getActivityFile(SID)!.notifyDebounceUntil;
    expect(lockedUntil).not.toBeNull();

    // setDequeueActive cycle without calling releaseNotifyDebounce
    setDequeueActive(SID, true);
    setDequeueActive(SID, false);
    // releaseNotifyDebounce NOT called

    // Debounce must still be active — only releaseNotifyDebounce() clears it
    expect(getActivityFile(SID)!.notifyDebounceUntil).toBe(lockedUntil);
  });

  it("AC6: releaseNotifyDebounce clears debounce (timeout-exit path now calls it)", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(getActivityFile(SID)!.notifyDebounceUntil).not.toBeNull();

    // Simulate the new timeout-exit behavior: dequeue.ts now sets _debounceRelease=true
    // on timeout exits, so the finally block calls releaseNotifyDebounce.
    releaseNotifyDebounce(SID);

    // Debounce is cleared — a subsequent notify from a reminder will not be suppressed
    expect(getActivityFile(SID)!.notifyDebounceUntil).toBeNull();
  });

  it("AC6: message arriving during debounce while agent polls → no additional notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Operator sends during debounce
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Still exactly one notify
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    expect(getActivityFile(SID)!.notifyPendingBecauseDebounce).toBe(true);
  });

  // ── AC 7: In-flight dequeue suppresses notifications ──────────────────────
  it("AC7: operator message during inflight dequeue → zero appendFile calls", async () => {
    setActivityFile(SID, makeState({ inflightDequeue: true }));

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    // Debounce should NOT be set (notify was suppressed by inflightDequeue check)
    expect(getActivityFile(SID)!.notifyDebounceUntil).toBeNull();
  });

  it("AC7: after dequeue ends (setDequeueActive false), next inbound fires notify", async () => {
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
  it("AC8: appendFile fails → debounce NOT set; next inbound retries", async () => {
    vi.mocked(appendFile).mockRejectedValueOnce(
      Object.assign(new Error("EPERM"), { code: "EPERM" }),
    );
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entry = getActivityFile(SID)!;
    // Debounce should be rolled back after failure
    expect(entry.notifyDebounceUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
    // pendingRetryHandle should be set (retry scheduled)
    expect(entry.pendingRetryHandle).not.toBeNull();
  });

  it("AC8: retry succeeds → debounce is set after successful retry", async () => {
    vi.mocked(appendFile)
      .mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }))
      .mockResolvedValue(undefined); // retry succeeds

    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve(); // first attempt fails, retry scheduled

    const entryAfterFail = getActivityFile(SID)!;
    expect(entryAfterFail.notifyDebounceUntil).toBeNull();
    expect(entryAfterFail.pendingRetryHandle).not.toBeNull();

    // Fire the retry timer (1s delay)
    vi.advanceTimersByTime(1_100);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    const entryAfterRetry = getActivityFile(SID)!;
    expect(entryAfterRetry.notifyDebounceUntil).not.toBeNull(); // debounce set after retry success
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC 9: Source classification ───────────────────────────────────────────
  it("AC9: service message during inflight dequeue (inflightAtEnqueue=true) → no notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "service", true); // inflightAtEnqueue=true
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    expect(getActivityFile(SID)!.notifyDebounceUntil).toBeNull();
  });

  it("AC9: service message to idle session (inflightAtEnqueue=false) → notify fires", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "service", false); // inflightAtEnqueue=false → idle session
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: reminder to idle session → notify fires", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "reminder", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("AC9: bridge-internal event → no notify regardless of inflightAtEnqueue", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "bridge-internal", false);
    notifyIfAllowed(SID, "bridge-internal", true);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  // ── AC 10: Reconnect resets state ─────────────────────────────────────────
  it("AC10: resetNotifyGateState clears debounce mid-debounce", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(getActivityFile(SID)!.notifyDebounceUntil).not.toBeNull();

    resetNotifyGateState(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.notifyDebounceUntil).toBeNull();
    expect(entry.notifyPendingBecauseDebounce).toBe(false);
    expect(entry.touchInFlight).toBe(false);
  });

  it("AC10: next inbound after resetNotifyGateState triggers immediate notify (debounce cleared)", async () => {
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

  it("handleSessionStopped: resets gate and notifies if queue has pending", async () => {
    setActivityFile(SID, makeState({ notifyDebounceUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(true);

    const result = handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(result.noOp).toBe(false);
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it("handleSessionStopped: resets gate but does NOT notify if queue empty", async () => {
    setActivityFile(SID, makeState({ notifyDebounceUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    handleSessionStopped(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
    const entry = getActivityFile(SID)!;
    expect(entry.notifyDebounceUntil).toBeNull(); // debounce reset, not notified
  });

  it("handleSessionStopped is idempotent across multiple calls", async () => {
    setActivityFile(SID, makeState({ notifyDebounceUntil: Date.now() + 300_000 }));
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    // First call acts (resets gate, no notify since queue empty)
    const result1 = handleSessionStopped(SID);
    // Second call on same sid — entry still exists (no file, SSE-only scenario has no entry)
    // but with a file-registered session, entry persists and second call is still a no-op
    // in terms of notification (queue still empty, debounce already null)
    const result2 = handleSessionStopped(SID);

    expect(result1.noOp).toBe(false); // first call acted on an existing entry
    expect(result2.noOp).toBe(false); // second call also finds the entry (it's not deleted)
    // Neither call should have triggered a notification (queue empty)
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  // ── replaceActivityFile ────────────────────────────────────────────────────
  it("replaceActivityFile: carries over gate state from old entry", async () => {
    const oldState = makeState({ notifyDebounceUntil: Date.now() + 300_000 });
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file" });
    await replaceActivityFile(SID, newState);

    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.notifyDebounceUntil).toBe(oldState.notifyDebounceUntil); // debounce carried over
  });

  it("replaceActivityFile: concurrent notifyIfAllowed reaches new entry", async () => {
    const oldState = makeState({ notifyDebounceUntil: null }); // no debounce
    setActivityFile(SID, oldState);

    const newState = makeState({ filePath: "/tmp/new-file", notifyDebounceUntil: null });
    const replacePromise = replaceActivityFile(SID, newState);

    // Touch fires while replace is still awaiting cleanup
    notifyIfAllowed(SID, "operator", false);

    await replacePromise;
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // newState should have been notified
    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    expect(entry.notifyDebounceUntil).not.toBeNull();
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
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
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
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
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

  it("ENOENT recovery: debounce is rolled back when recreation fails", async () => {
    const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("EPERM"));

    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Touch ultimately failed → debounce must be rolled back
    const entry = getActivityFile(SID)!;
    expect(entry.notifyDebounceUntil).toBeNull();
    expect(entry.touchInFlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5-minute active re-notify — §5-a (10-2303)
// ---------------------------------------------------------------------------

describe("5-minute active re-notify (§5-a)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC-5: Parked agent re-notify fires once after debounce ─────────────────
  it("AC-5: parked agent — re-notify fires exactly once after 5 min, then silence", async () => {
    setActivityFile(SID, makeState());

    // Initial notify
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Agent does NOT dequeue — timer fires after debounce
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Re-notify should have fired: exactly 1 additional touch
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);

    // Advance another full debounce window — no further re-notify (one-shot)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  // ── AC-6: Agent dequeues before timer fires → no extra touch ──────────────
  it("AC-6: dequeue before 5 min cancels re-notify timer — no extra touch fires", async () => {
    setActivityFile(SID, makeState());

    // Notify
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Queue drains (agent dequeues before 5 min) — cancels pending re-notify
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Should still be 1 — no re-eval (queue was empty)
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    // Advance past where the old timer would have fired — still no extra touch
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });

  // ── AC-7: Fresh re-notify cycle after content-returning dequeue + new content ─
  it("AC-7: dequeue + new content → fresh 5-min timer; old cancelled; re-notify fires once", async () => {
    setActivityFile(SID, makeState());

    // First notify — registers timer T1
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    const entryAfterNotify = getActivityFile(SID)!;
    const handleT1 = entryAfterNotify.pendingReNotifyHandle;
    expect(handleT1).not.toBeNull();

    // Content-returning dequeue: cancels T1, clears debounce
    queueMocks.hasPendingUserContent.mockReturnValue(true); // still has content
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // releaseNotifyDebounce called fireRevaluationNotify (notifyPendingBecauseDebounce was false,
    // but pending is false so no re-eval here — debounce cleared, T1 cancelled).
    // Actually releaseNotifyDebounce fires re-eval only if notifyPendingBecauseDebounce was true.
    // Since we didn't suppress any notify, pending is false → no re-eval notify.
    // appendFile count: still 1 (no re-eval fired from releaseNotifyDebounce).

    // T1 must be cancelled after releaseNotifyDebounce
    const entryAfterRelease = getActivityFile(SID)!;
    expect(entryAfterRelease.pendingReNotifyHandle).toBeNull();
    expect(entryAfterRelease.notifyDebounceUntil).toBeNull();

    // New content enqueued → agent idle → notifyIfAllowed fires, registers timer T2
    vi.mocked(appendFile).mockClear();
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);

    const entryAfterNewNotify = getActivityFile(SID)!;
    const handleT2 = entryAfterNewNotify.pendingReNotifyHandle;
    expect(handleT2).not.toBeNull();
    expect(handleT2).not.toBe(handleT1); // fresh handle

    // Advance 5 min → T2 fires → re-notify
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // One additional touch from T2 re-notify
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);

    // No further re-notify after that (one-shot)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// AC-11: initSseNotifyCallback — SSE parity for file-state re-evaluation path
// ---------------------------------------------------------------------------

describe("AC-11: initSseNotifyCallback SSE parity", () => {
  let sseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
    sseSpy = vi.fn();
    initSseNotifyCallback(sseSpy as (sid: number) => void);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AC-3 equiv: releaseNotifyDebounce with pending → SSE fires once
  it("AC-3 equiv: debounce active + pending → releaseNotifyDebounce fires SSE once", async () => {
    setActivityFile(SID, {
      ...makeState(),
      notifyDebounceUntil: Date.now() + 10_000,
      notifyPendingBecauseDebounce: true,
      touchInFlight: false,
    });
    queueMocks.hasPendingUserContent.mockReturnValue(true);

    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).toHaveBeenCalledTimes(1);
  });

  // AC-4 equiv: no debounce + not pending → releaseNotifyDebounce is a no-op
  it("AC-4 equiv: no debounce + no pending → releaseNotifyDebounce fires SSE zero times", async () => {
    setActivityFile(SID, {
      ...makeState(),
      notifyDebounceUntil: null,
      notifyPendingBecauseDebounce: false,
      touchInFlight: false,
    });

    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).toHaveBeenCalledTimes(0);
  });

  // AC-5 equiv: parked agent — SSE re-notify fires after 5-min debounce window
  it("AC-5 equiv: 5-min inactivity → exactly 1 SSE write via _sseNotifyCallback", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // SSE not called yet — callback is for re-evaluation, not the initial notify
    expect(sseSpy).not.toHaveBeenCalled();

    // Advance 5 min → timer fires → fireRevaluationNotify → _sseNotifyCallback
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).toHaveBeenCalledTimes(1);

    // One-shot: no further SSE after the re-notify window
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(sseSpy).toHaveBeenCalledTimes(1);
  });

  // AC-6 equiv: queue drains before 5 min → no SSE re-notify
  it("AC-6 equiv: queue drains before 5 min → no SSE re-notify", async () => {
    setActivityFile(SID, makeState());

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Queue empties — content-returning dequeue clears debounce and cancels timer
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Advance past where old timer would have fired
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).not.toHaveBeenCalled();
  });

  // AC-7 equiv: dequeue resets timer → fresh 5-min window fires SSE once
  it("AC-7 equiv: dequeue resets timer → fresh 5-min window fires SSE once", async () => {
    setActivityFile(SID, makeState());

    // First notify — registers timer T1
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Content-returning dequeue: queue still has content, releases debounce (cancels T1)
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    releaseNotifyDebounce(SID);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // New content → fresh notifyIfAllowed → timer T2 set
    vi.mocked(appendFile).mockClear();
    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).not.toHaveBeenCalled();

    // Advance 5 min → T2 fires → SSE notify
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    expect(sseSpy).toHaveBeenCalledTimes(1);

    // No further SSE (one-shot)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(sseSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SSE-only monitor gate (activity/listen with NO activity file). This is the
// path that previously got ZERO kicks: notifyIfAllowed declined at `!entry`
// because only file registration created gate state. registerSseMonitor now
// gives an SSE-only session a fileless gate entry so it obeys the SAME gate.
// ---------------------------------------------------------------------------

describe("SSE-only monitor gate (no activity file)", () => {
  let sseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
    sseSpy = vi.fn();
    initSseNotifyCallback(sseSpy as (sid: number) => void);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registerSseMonitor creates a fileless gate entry; getActivityFile hides it", () => {
    registerSseMonitor(SID);
    // No FILE is registered, so the file-oriented accessor reports nothing…
    expect(getActivityFile(SID)).toBeUndefined();
    // …but the gate is live: an operator event is now allowed through.
    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);
  });

  it("first operator event → gate allows it (caller fires SSE), no file touched", async () => {
    registerSseMonitor(SID);

    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // SSE-only: there is no file, so appendFile must never be called.
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  it("burst of events → allowed once then debounced (parity with file path)", () => {
    registerSseMonitor(SID);

    // First event opens the debounce → allowed.
    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);
    // Nine more during the debounce window → all suppressed.
    for (let i = 0; i < 9; i++) {
      expect(notifyIfAllowed(SID, "operator", false)).toBe(false);
    }
  });

  it("content-returning dequeue releases the debounce → SSE re-kick fires once", async () => {
    registerSseMonitor(SID);

    notifyIfAllowed(SID, "operator", false); // opens debounce
    notifyIfAllowed(SID, "operator", false); // suppressed → notifyPendingBecauseDebounce
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    releaseNotifyDebounce(SID); // dequeue exit with pending content
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Re-evaluation kicks the SSE stream (no file → no appendFile).
    expect(sseSpy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  it("5-min inactivity → exactly one SSE re-kick, then silence (one-shot)", async () => {
    registerSseMonitor(SID);

    notifyIfAllowed(SID, "operator", false);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(sseSpy).not.toHaveBeenCalled(); // initial kick is the caller's job

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(sseSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    expect(sseSpy).toHaveBeenCalledTimes(1); // one-shot
  });

  it("in-flight dequeue suppresses the kick (parity with file path)", () => {
    registerSseMonitor(SID);
    setDequeueActive(SID, true);

    // Agent is mid-dequeue → event delivered inline, no kick.
    expect(notifyIfAllowed(SID, "operator", false)).toBe(false);
  });

  it("unregisterSseMonitor tears down the gate when no file remains", () => {
    registerSseMonitor(SID);
    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);

    unregisterSseMonitor(SID);
    // Gate entry gone → back to the original `!entry` decline.
    expect(notifyIfAllowed(SID, "operator", false)).toBe(false);
  });

  it("file + SSE: clearing the file keeps the gate alive for the SSE stream", async () => {
    // Register a file first, then attach SSE on the same session.
    setActivityFile(SID, makeState());
    registerSseMonitor(SID);
    expect(getActivityFile(SID)).toBeDefined();

    await clearActivityFile(SID);

    // File view is gone, but the SSE gate persists and still passes events.
    expect(getActivityFile(SID)).toBeUndefined();
    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);
  });

  it("file + SSE: dropping SSE keeps the gate alive for the file monitor", () => {
    setActivityFile(SID, makeState());
    registerSseMonitor(SID);

    unregisterSseMonitor(SID);

    // File monitor still registered → gate persists.
    expect(getActivityFile(SID)).toBeDefined();
    expect(notifyIfAllowed(SID, "operator", false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getFirstNotifyTimestamp — AC3/AC4 of offline detection (task 10-0011)
// ---------------------------------------------------------------------------

describe("getFirstNotifyTimestamp — offline-detection first-notify tracking", () => {
  let sseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    sessionMocks.getNotifyDebounceMs.mockReturnValue(DEBOUNCE_MS);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    vi.mocked(appendFile).mockResolvedValue(undefined);
    sseSpy = vi.fn();
    initSseNotifyCallback(sseSpy as (sid: number) => void);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for an unknown session (no gate entry)", () => {
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });

  it("returns null for a session with a gate entry that has not yet been notified", () => {
    setActivityFile(SID, makeState({ notifyDebounceUntil: Date.now() + DEBOUNCE_MS }));
    // No notifyIfAllowed call yet → still null
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });

  it("records a timestamp when notifyIfAllowed returns true", () => {
    const before = Date.now();
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    const after = Date.now();

    const ts = getFirstNotifyTimestamp(SID);
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  it("does NOT overwrite the first timestamp on subsequent notifications", () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false); // first notify
    const first = getFirstNotifyTimestamp(SID);

    // Advance time so the debounce expires and a second notify can fire
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    notifyIfAllowed(SID, "operator", false); // second notify

    // Timestamp must not change — first-notify semantics
    expect(getFirstNotifyTimestamp(SID)).toBe(first);
  });

  it("stays null when notifyIfAllowed is debounced (returns false)", () => {
    // Pre-arm the debounce so the first call is suppressed
    setActivityFile(SID, makeState({ notifyDebounceUntil: Date.now() + DEBOUNCE_MS }));

    const result = notifyIfAllowed(SID, "operator", false);
    expect(result).toBe(false); // debounced
    expect(getFirstNotifyTimestamp(SID)).toBeNull(); // no timestamp set for suppressed notify
  });

  it("records a timestamp when fireRevaluationNotify fires (re-notify path)", async () => {
    setActivityFile(SID, makeState());

    // First notify — sets debounce and arms re-notify timer
    notifyIfAllowed(SID, "operator", false);
    // Flush the async file touch so touchInFlight resets before the timer fires
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    const firstTs = getFirstNotifyTimestamp(SID);
    expect(firstTs).not.toBeNull();

    // Advance past debounce window → timer fires → fireRevaluationNotify → sseSpy called
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();

    // Timestamp must still be the first one (re-notify does not overwrite)
    expect(getFirstNotifyTimestamp(SID)).toBe(firstTs);
    expect(sseSpy).toHaveBeenCalledTimes(1); // re-notify fired
  });

  it("preserves timestamp on timeout/animation_stale_warning exit (content still pending)", () => {
    // When releaseNotifyDebounce is called by dequeue.ts on timeout exits or
    // animation_stale_warning returns, hasPendingUserContent is still true because
    // no user content was consumed.  The first-notify clock must be preserved so
    // the 10-minute grace window keeps counting from the original notification (AC4).
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    const ts = getFirstNotifyTimestamp(SID);
    expect(ts).not.toBeNull();

    // hasPendingUserContent = true (beforeEach default) — content NOT consumed
    releaseNotifyDebounce(SID); // called by finally block on timeout/synthetic exit
    expect(getFirstNotifyTimestamp(SID)).toBe(ts); // clock preserved
  });

  it("resets to null after a content-returning dequeue (releaseNotifyDebounce)", () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    expect(getFirstNotifyTimestamp(SID)).not.toBeNull();

    // Simulate content-returning exit: agent consumed the batch → queue empty.
    // releaseNotifyDebounce only deletes _firstNotifyTs when no pending content
    // remains, so we must reflect the post-dequeue state (AC4 fix).
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyDebounce(SID);
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });

  it("after reset, records a fresh timestamp on the next notification", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    // Flush async file touch so touchInFlight resets to false before the next notify
    for (let _f = 0; _f < 10; _f++) await Promise.resolve();
    const first = getFirstNotifyTimestamp(SID);

    // Simulate content-returning exit: queue is now empty → _firstNotifyTs cleared.
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    releaseNotifyDebounce(SID);
    expect(getFirstNotifyTimestamp(SID)).toBeNull();

    // New message arrives → debounce cleared → fresh notification allowed
    notifyIfAllowed(SID, "operator", false);
    const second = getFirstNotifyTimestamp(SID);
    expect(second).not.toBeNull();
    expect(second).toBeGreaterThanOrEqual(first!); // monotonically non-decreasing
  });

  it("cleans up when SSE-only gate is torn down via unregisterSseMonitor", () => {
    registerSseMonitor(SID);
    notifyIfAllowed(SID, "operator", false);
    expect(getFirstNotifyTimestamp(SID)).not.toBeNull();

    unregisterSseMonitor(SID); // tears down gate (no file registered)
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });

  it("cleans up when last monitor is cleared via clearActivityFile", async () => {
    setActivityFile(SID, makeState());
    notifyIfAllowed(SID, "operator", false);
    expect(getFirstNotifyTimestamp(SID)).not.toBeNull();

    await clearActivityFile(SID); // no SSE connected → gate torn down
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });

  it("records timestamp for SSE-only gate (registerSseMonitor path)", () => {
    registerSseMonitor(SID);
    expect(getFirstNotifyTimestamp(SID)).toBeNull();

    notifyIfAllowed(SID, "operator", false);
    expect(getFirstNotifyTimestamp(SID)).not.toBeNull();
  });

  it("handleSessionStopped records first-notify when content is pending", () => {
    registerSseMonitor(SID);
    queueMocks.hasPendingUserContent.mockReturnValue(true);

    expect(getFirstNotifyTimestamp(SID)).toBeNull(); // no prior notify
    handleSessionStopped(SID);
    // handleSessionStopped fires _sseNotifyCallback when content is pending
    expect(getFirstNotifyTimestamp(SID)).not.toBeNull();
  });

  it("handleSessionStopped does NOT record timestamp when queue is empty", () => {
    registerSseMonitor(SID);
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    handleSessionStopped(SID);
    expect(getFirstNotifyTimestamp(SID)).toBeNull();
  });
});
