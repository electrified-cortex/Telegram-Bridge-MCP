/**
 * Tests for the activity-file idle-kick state machine (task 10-0876, 10-0896).
 *
 * Covers:
 *   1. Nudge fires immediately when agent has been silent >= debounce window
 *   2. Nudge is suppressed when agent was recently active (< debounce window)
 *   3. Timer schedules and fires after remaining suppression window
 *   4. recordActivityTouch updates lastActivityAt but does NOT cancel pending kick timer
 *   5. Nudge does not fire while dequeue is in-flight (inflightDequeue)
 *   6. Multiple messages in one cycle produce exactly one nudge (one-nudge-per-cycle)
 *   7. setDequeueActive(false) re-arms cycle; subsequent message can nudge again
 *   8. Per-session debounce override is respected (getKickDebounceMs)
 *   9. replaceActivityFile atomic swap: concurrent touchActivityFile reaches new entry
 *  10. replaceActivityFile timer generation check: old debounce timer does not kick after replacement
 *  11. recordActivityTouch during pending timer does not cancel kick (fix for 10-0893)
 *  12. handleSessionStopped cancels timer, re-arms nudge, fires touch when queue has pending
 *  13. handleSessionStopped returns noOp: true when no activity file registered
 * AC4-1. Stop + empty queue → no kick (10-0896)
 * AC4-2. Stop + pending message → kick fires (10-0896)
 * AC4-3. Debounce expiry + empty queue → no kick (10-0896)
 * AC4-4. Debounce expiry + pending message → kick fires (10-0896)
 * AC4-5. Stop resets lastActivityAt so next touch with pending kicks immediately (10-0896)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock session-gate to control requireAuth per-test
const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 42),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

// Mock session-manager to control getKickDebounceMs per-test
const sessionMocks = vi.hoisted(() => ({
  getKickDebounceMs: vi.fn((_sid: number): number => 60_000),
}));

vi.mock("../../session-manager.js", () => ({
  getKickDebounceMs: (sid: number) => sessionMocks.getKickDebounceMs(sid),
}));

// Mock session-queue to control hasPendingUserContent per-test (10-0896)
const queueMocks = vi.hoisted(() => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => true),
}));

vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: (sid: number) => queueMocks.hasPendingUserContent(sid),
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
  touchActivityFile,
  recordActivityTouch,
  setDequeueActive,
  replaceActivityFile,
  handleSessionStopped,
  resetActivityFileStateForTest,
} from "./file-state.js";

import { handleActivityFileCreate } from "./create.js";
import { handleActivityFileEdit } from "./edit.js";

const SID = 42;

function makeState(overrides: Partial<{
  lastActivityAt: number;
  inflightDequeue: boolean;
  nudgeArmed: boolean;
  lastTouchAt: number | null;
}> = {}) {
  return {
    filePath: "/tmp/test-activity-file",
    tmcpOwned: false,
    lastTouchAt: (overrides.lastTouchAt !== undefined ? overrides.lastTouchAt : null),
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
    lastActivityAt: overrides.lastActivityAt ?? 0,
    inflightDequeue: overrides.inflightDequeue ?? false,
    nudgeArmed: overrides.nudgeArmed ?? true,
  };
}

describe("activity-file idle-kick state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActivityFileStateForTest();
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
    // Default: queue has pending content so existing kick tests pass unchanged.
    // AC4 "no kick" tests override this to false.
    queueMocks.hasPendingUserContent.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1: nudge fires immediately when agent has been silent >= debounce window", () => {
    const state = makeState({ lastActivityAt: Date.now() - 120_000 }); // 2 min ago
    setActivityFile(SID, state);

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(false);          // disarmed after firing
    expect(entry.debounceTimer).toBeNull();         // no pending timer
    expect(entry.lastTouchAt).not.toBeNull();       // touch was recorded
  });

  it("2: nudge is suppressed when agent was recently active (< debounce window)", () => {
    const state = makeState({ lastActivityAt: Date.now() - 5_000 }); // 5 s ago
    setActivityFile(SID, state);

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(true);           // still armed — not fired yet
    expect(entry.lastTouchAt).toBeNull();           // no touch issued
    expect(entry.debounceTimer).not.toBeNull();     // timer scheduled to fire later
  });

  it("3: scheduled timer fires the nudge after the remaining suppression window", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(10_000); // 10 s for test speed
    const state = makeState({ lastActivityAt: Date.now() - 3_000 }); // 3 s ago
    setActivityFile(SID, state);

    touchActivityFile(SID);

    // Timer should be pending, no touch yet
    const entryBefore = getActivityFile(SID)!;
    expect(entryBefore.lastTouchAt).toBeNull();

    // Advance time past the remaining window (10s - 3s = 7s remaining)
    vi.advanceTimersByTime(8_000);

    const entryAfter = getActivityFile(SID)!;
    expect(entryAfter.nudgeArmed).toBe(false);     // fired after delay
    expect(entryAfter.lastTouchAt).not.toBeNull(); // touch issued
  });

  it("4: recordActivityTouch updates lastActivityAt but does NOT cancel pending kick timer", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(10_000);
    const state = makeState({ lastActivityAt: Date.now() - 3_000 });
    setActivityFile(SID, state);

    touchActivityFile(SID); // schedules timer (3s elapsed of 10s window)

    const entryBefore = getActivityFile(SID)!;
    expect(entryBefore.debounceTimer).not.toBeNull();

    const prevActivityAt = entryBefore.lastActivityAt;
    recordActivityTouch(SID); // agent makes a tool call — must NOT cancel timer

    const entryAfter = getActivityFile(SID)!;
    expect(entryAfter.debounceTimer).not.toBeNull();       // timer still pending
    expect(entryAfter.lastActivityAt).toBeGreaterThan(prevActivityAt); // window extended

    // Timer fires after the remaining window — nudge DOES land
    vi.advanceTimersByTime(15_000);
    expect(getActivityFile(SID)!.lastTouchAt).not.toBeNull(); // kick fired
  });

  it("5: nudge does not fire while dequeue is in-flight (inflightDequeue=true)", () => {
    const state = makeState({
      lastActivityAt: Date.now() - 120_000,
      inflightDequeue: true,
    });
    setActivityFile(SID, state);

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).toBeNull();           // no touch while dequeue active
    expect(entry.nudgeArmed).toBe(true);             // still armed, just blocked
  });

  it("6: multiple messages in one cycle produce exactly one nudge", () => {
    const state = makeState({ lastActivityAt: Date.now() - 120_000 }); // long idle
    setActivityFile(SID, state);

    // First call fires the nudge
    touchActivityFile(SID);
    const firstTouchAt = getActivityFile(SID)!.lastTouchAt;
    expect(firstTouchAt).not.toBeNull();

    // Subsequent calls in the same cycle (nudgeArmed=false) → no-op
    touchActivityFile(SID);
    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).toBe(firstTouchAt);  // unchanged — no additional touches
  });

  it("7: setDequeueActive(false) re-arms cycle; next message can nudge again", () => {
    const state = makeState({ lastActivityAt: Date.now() - 120_000 });
    setActivityFile(SID, state);

    // Cycle 1: fire nudge
    touchActivityFile(SID);
    expect(getActivityFile(SID)!.nudgeArmed).toBe(false);

    // Simulate dequeue completion
    setDequeueActive(SID, false);
    expect(getActivityFile(SID)!.nudgeArmed).toBe(true); // re-armed

    // Cycle 2: after re-arming, wait for debounce window and nudge again
    // lastActivityAt was reset by setDequeueActive — advance past debounce window
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000);
    vi.advanceTimersByTime(6_000); // advance past 5s default

    const beforeSecondTouch = getActivityFile(SID)!.lastTouchAt;

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(false);           // fired again
    expect(entry.lastTouchAt).not.toBe(beforeSecondTouch); // new touch timestamp
  });

  it("8: per-session debounce override is respected via getKickDebounceMs", () => {
    // Use a very long debounce (300 s)
    sessionMocks.getKickDebounceMs.mockReturnValue(300_000);
    const state = makeState({ lastActivityAt: Date.now() - 60_000 }); // 60 s ago
    setActivityFile(SID, state);

    touchActivityFile(SID);

    // 60s < 300s → still suppressed, timer pending
    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(true);
    expect(entry.lastTouchAt).toBeNull();
    expect(entry.debounceTimer).not.toBeNull();    // timer set for remaining 240s
  });

  it("9: replaceActivityFile atomic swap — concurrent touchActivityFile reaches new entry", async () => {
    // Simulate a touch that arrives while replaceActivityFile is mid-flight.
    // Because _state is updated before any async cleanup, the touch must land
    // on the new entry (newState), not be silently dropped.
    const oldState = makeState({ lastActivityAt: Date.now() - 120_000 }); // long idle
    setActivityFile(SID, oldState);

    const newState = {
      filePath: "/tmp/test-activity-file-new",
      tmcpOwned: false,
      lastTouchAt: null,
      debounceTimer: null,
      lastActivityAt: Date.now() - 120_000,
      inflightDequeue: false,
      nudgeArmed: true,
    };

    // replaceActivityFile writes newState to _state synchronously before awaiting
    // any cleanup, so a touch fired immediately after the call sees newState.
    const replacePromise = replaceActivityFile(SID, newState);

    // Touch fires while replace is still awaiting cleanup
    touchActivityFile(SID);

    await replacePromise;

    // The entry in _state must be newState (not undefined, not oldState)
    const entry = getActivityFile(SID)!;
    expect(entry).toBe(newState);
    // Touch reached the new entry — lastTouchAt was updated on newState
    expect(entry.lastTouchAt).not.toBeNull();
  });

  it("11: recordActivityTouch during pending timer does not cancel kick (fix for 10-0893)", () => {
    // Regression test: prior to the fix, recordActivityTouch cancelled the pending
    // debounce timer on every tool call. An active agent making tool calls would
    // never see a kick, even after receiving an inbound message.
    sessionMocks.getKickDebounceMs.mockReturnValue(10_000);
    const state = makeState({ lastActivityAt: Date.now() - 5_000 }); // 5s ago
    setActivityFile(SID, state);

    // Inbound arrives → within debounce window → timer scheduled
    touchActivityFile(SID);
    expect(getActivityFile(SID)!.debounceTimer).not.toBeNull();

    // Agent makes several tool calls — must NOT cancel the timer
    recordActivityTouch(SID);
    recordActivityTouch(SID);
    recordActivityTouch(SID);

    // Timer must still be pending after tool calls
    expect(getActivityFile(SID)!.debounceTimer).not.toBeNull();

    // Advance past debounce window — kick must still fire
    vi.advanceTimersByTime(15_000);
    expect(getActivityFile(SID)!.lastTouchAt).not.toBeNull(); // kick landed
    expect(getActivityFile(SID)!.nudgeArmed).toBe(false);    // cycle disarmed
  });

  it("10: replaceActivityFile timer generation check — old debounce timer does not kick after replacement", async () => {
    // Schedule a debounce timer on the old entry. After replacement, the old
    // timer fires but finds the current _state entry is no longer the old
    // object — the generation guard (checking _state.get(sid) identity) must
    // prevent a stale kick from landing.
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000); // 5 s debounce
    const oldState = makeState({ lastActivityAt: Date.now() - 3_000 }); // 3 s ago
    setActivityFile(SID, oldState);

    // Trigger a touch so that a debounce timer is scheduled on oldState
    touchActivityFile(SID);
    expect(oldState.debounceTimer).not.toBeNull(); // timer is set

    // Replace with a new entry (replaceActivityFile cancels the old timer)
    const newState = {
      filePath: "/tmp/test-activity-file-gen",
      tmcpOwned: false,
      lastTouchAt: null,
      debounceTimer: null,
      lastActivityAt: Date.now(), // freshly active — suppress any new kick
      inflightDequeue: false,
      nudgeArmed: true,
    };

    await replaceActivityFile(SID, newState);

    // Old timer must have been cancelled by replaceActivityFile
    expect(oldState.debounceTimer).toBeNull();

    // Advance past the original debounce window — no stale kick should fire
    vi.advanceTimersByTime(10_000);

    // newState.lastTouchAt should remain null — the cancelled timer never fired
    // and newState.lastActivityAt is fresh so no immediate kick either
    expect(getActivityFile(SID)!.lastTouchAt).toBeNull();
  });

  it("12: handleSessionStopped cancels pending timer, re-arms nudge, and fires immediate touch", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
    const state = makeState({ lastActivityAt: Date.now() - 5_000 }); // recently active
    setActivityFile(SID, state);

    // Schedule a pending timer (5 s elapsed of 60 s window)
    touchActivityFile(SID);
    expect(getActivityFile(SID)!.debounceTimer).not.toBeNull();
    expect(getActivityFile(SID)!.nudgeArmed).toBe(true); // armed, timer pending

    const result = handleSessionStopped(SID);

    expect(result.noOp).toBe(false);
    const entry = getActivityFile(SID)!;
    expect(entry.debounceTimer).toBeNull();       // timer cancelled
    expect(entry.nudgeArmed).toBe(true);           // re-armed
    expect(entry.lastTouchAt).not.toBeNull();      // immediate touch fired
  });

  it("13: handleSessionStopped returns noOp: true when no activity file registered", () => {
    const result = handleSessionStopped(SID);
    expect(result.noOp).toBe(true);
  });

  // --- AC4: Queue-conditional kick (task 10-0896) ---

  it("AC4-1/AC6-1: stop + empty queue → no poke", () => {
    queueMocks.hasPendingUserContent.mockReturnValue(false); // empty queue
    const state = makeState({ lastActivityAt: Date.now() - 5_000 });
    setActivityFile(SID, state);

    const result = handleSessionStopped(SID);

    expect(result.noOp).toBe(false);
    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(true);   // re-armed
    expect(entry.lastActivityAt).toBe(0);  // reset
    expect(entry.lastTouchAt).toBeNull();  // no kick — empty queue
  });

  it("AC4-2/AC6-2: stop + pending message → poke fires", () => {
    // default mock returns true
    const state = makeState({ lastActivityAt: Date.now() - 5_000 });
    setActivityFile(SID, state);

    const result = handleSessionStopped(SID);

    expect(result.noOp).toBe(false);
    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(true);          // re-armed
    expect(entry.lastActivityAt).toBe(0);         // reset
    expect(entry.lastTouchAt).not.toBeNull();     // kick fired
  });

  it("AC4-3: debounce expiry + empty queue → no kick, re-arms nudge", () => {
    queueMocks.hasPendingUserContent.mockReturnValue(false); // empty queue
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000);
    const state = makeState({ lastActivityAt: Date.now() - 2_000 }); // 2s of 5s elapsed
    setActivityFile(SID, state);

    touchActivityFile(SID); // schedules timer for remaining 3s
    expect(getActivityFile(SID)!.lastTouchAt).toBeNull();

    vi.advanceTimersByTime(4_000); // timer fires → re-evaluates touchActivityFile

    const entry = getActivityFile(SID)!;
    // AC4 refined: trailing-timer with empty queue re-arms nudge (no permanent un-arm)
    expect(entry.nudgeArmed).toBe(true);
    expect(entry.lastTouchAt).toBeNull();  // no kick — empty queue
  });

  it("AC4-4: debounce expiry + pending message → kick fires", () => {
    // default mock returns true
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000);
    const state = makeState({ lastActivityAt: Date.now() - 2_000 }); // 2s of 5s elapsed
    setActivityFile(SID, state);

    touchActivityFile(SID); // schedules timer
    expect(getActivityFile(SID)!.lastTouchAt).toBeNull();

    vi.advanceTimersByTime(4_000); // timer fires → kick

    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(false);
    expect(entry.lastTouchAt).not.toBeNull(); // kick fired
  });

  // --- AC6 (refined): poke-debounce tests (task 10-0896 refined spec) ---

  it("AC6-3: stop + pending + recent poke → poke fires (Stop overrides debounce)", () => {
    // Stop hook is an active→inactive transition that resets the poke-debounce.
    // A poke that was very recent must NOT suppress the stop-triggered poke.
    // (In fake-timer mode two consecutive Date.now() calls return the same value,
    //  so we verify only that a poke happened, not that the timestamp changed.)
    const state = makeState({
      lastActivityAt: Date.now() - 5_000,
      lastTouchAt: Date.now(), // simulate a very recent poke
    });
    setActivityFile(SID, state);

    // Queue has pending content (default mock = true)
    const result = handleSessionStopped(SID);

    expect(result.noOp).toBe(false);
    const entry = getActivityFile(SID)!;
    // Stop resets lastTouchAt=null then fires shouldPoke(forceReset=true) → poke lands
    expect(entry.lastTouchAt).not.toBeNull(); // kick happened despite recent prior poke
    // Verify the reset happened: lastActivityAt must be 0 (stop transition)
    expect(entry.lastActivityAt).toBe(0);
  });

  it("AC6-6: inbound inactive + pending + recent poke (< debounce) → no poke", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
    const recentPokeAt = Date.now();
    // clearly inactive: lastActivityAt=0 → timeSinceActivity >> 60s → inactive check passes
    const state = makeState({ lastActivityAt: 0, lastTouchAt: recentPokeAt });
    setActivityFile(SID, state);

    // Queue has pending content (default mock = true)
    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    // Poke-debounce prevents a second poke so soon after the first
    expect(entry.lastTouchAt).toBe(recentPokeAt); // unchanged — no new poke
  });

  it("AC6-7: inbound inactive + pending + stale poke (>= debounce) → poke fires", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
    const stalePokeAt = Date.now() - 60_000; // exactly at debounce boundary
    const state = makeState({ lastActivityAt: 0, lastTouchAt: stalePokeAt });
    setActivityFile(SID, state);

    // Queue has pending content (default mock = true)
    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).not.toBe(stalePokeAt); // new poke timestamp
    expect(entry.lastTouchAt).not.toBeNull();
  });

  it("AC6-8: active→inactive transition (dequeue complete) resets poke-debounce", () => {
    // Use a short kick-debounce so we can advance past it in the test
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000);
    // Session starts with a recent poke (lastTouchAt within debounce window)
    const state = makeState({ lastActivityAt: Date.now() - 2_000, lastTouchAt: Date.now() });
    setActivityFile(SID, state);

    // Simulate dequeue complete — must reset poke-debounce (lastTouchAt=null)
    setDequeueActive(SID, false);

    const afterDequeue = getActivityFile(SID)!;
    expect(afterDequeue.lastTouchAt).toBeNull(); // poke-debounce reset by dequeue

    // Advance past the kick-debounce window so the session is classified inactive
    vi.advanceTimersByTime(6_000);

    // Queue has pending content (default mock = true); first poke after reset is free
    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).not.toBeNull(); // poke fired — no poke-debounce wait
  });

  it("AC4-5/AC6-9: stop resets lastActivityAt so next touch with pending kicks immediately", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
    const state = makeState({ lastActivityAt: Date.now() - 5_000 }); // recently active
    setActivityFile(SID, state);

    // Stop with empty queue — no kick, but lastActivityAt is reset to 0
    queueMocks.hasPendingUserContent.mockReturnValue(false);
    handleSessionStopped(SID);

    expect(getActivityFile(SID)!.lastTouchAt).toBeNull();
    expect(getActivityFile(SID)!.lastActivityAt).toBe(0); // confirmed reset

    // New message arrives: queue now has pending content
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    touchActivityFile(SID); // lastActivityAt=0 → timeSinceActivity >> debounce → immediate kick

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).not.toBeNull(); // kicked immediately, no 60s wait
    expect(entry.nudgeArmed).toBe(false);     // disarmed after kick
  });

  it("AC6-4: inbound while inactive + empty queue → no poke", () => {
    queueMocks.hasPendingUserContent.mockReturnValue(false); // empty queue
    const state = makeState({ lastActivityAt: 0, nudgeArmed: true }); // long idle = inactive
    setActivityFile(SID, state);

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).toBeNull();   // no poke fired
    expect(entry.nudgeArmed).toBe(true);    // re-armed because no poke resulted
  });

  it("AC6-5: inbound while inactive + pending + cold debounce → poke fires", () => {
    // default mock returns true (pending content)
    const state = makeState({ lastActivityAt: 0, lastTouchAt: null }); // long idle + cold debounce
    setActivityFile(SID, state);

    touchActivityFile(SID);

    const entry = getActivityFile(SID)!;
    expect(entry.lastTouchAt).not.toBeNull(); // poke fired
  });

  it("AC6-10: trailing-timer with empty queue → re-arms nudgeArmed", () => {
    // A timer is scheduled because an inbound arrived while the session was active.
    // If the queue is drained before the timer fires, the timer should:
    //   - not poke (empty queue)
    //   - re-arm nudgeArmed so the next actual inbound can kick
    //   - clear lastTouchAt so that next inbound gets a fresh poke window
    sessionMocks.getKickDebounceMs.mockReturnValue(5_000);
    // Session was recently active: 2s into 5s window → timer will be scheduled
    const state = makeState({ lastActivityAt: Date.now() - 2_000, lastTouchAt: Date.now() });
    setActivityFile(SID, state);

    // Inbound arrives → still active → schedules trailing timer
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    touchActivityFile(SID);
    expect(getActivityFile(SID)!.debounceTimer).not.toBeNull(); // timer scheduled

    // Queue is drained before timer fires
    queueMocks.hasPendingUserContent.mockReturnValue(false);

    // Timer fires
    vi.advanceTimersByTime(4_000);

    const entry = getActivityFile(SID)!;
    expect(entry.nudgeArmed).toBe(true);    // re-armed (AC4 refined)
    expect(entry.lastTouchAt).toBeNull();   // poke-debounce reset (AC2 trailing-timer reset)
    expect(entry.debounceTimer).toBeNull(); // no pending timer
  });
});

// ---------------------------------------------------------------------------
// AC7: activity/file/create — ALREADY_REGISTERED guard (task 10-0900)
// ---------------------------------------------------------------------------

describe("activity/file/create — ALREADY_REGISTERED guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    queueMocks.hasPendingUserContent.mockReturnValue(true);
    sessionMocks.getKickDebounceMs.mockReturnValue(60_000);
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
    expect(entry.filePath).toBe(firstPath); // original path preserved
    expect(entry.tmcpOwned).toBe(true);     // original ownership preserved
  });

  it("AC7d: edit works after failed create", async () => {
    await handleActivityFileCreate({ token: 99 }); // first create — succeeds
    await handleActivityFileCreate({ token: 99 }); // second create — fails

    // Edit (TMCP-generated path) must succeed despite the prior failed create
    const editResult = await handleActivityFileEdit({ token: 99 });
    expect((editResult as { isError?: true }).isError).toBeUndefined();
    const data = JSON.parse(editResult.content[0].text);
    expect(typeof data.file_path).toBe("string");
    expect(typeof data.previous_path).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// ENOENT recovery tests (task 30-0891)
// Isolated in their own describe so mock call counts start clean for each test.
// ---------------------------------------------------------------------------

describe("appendNewline ENOENT recovery", () => {
  beforeEach(async () => {
    // Drain all pending microtasks from prior tests (fire-and-forget appendNewline chains).
    for (let i = 0; i < 50; i++) await Promise.resolve();
    // Reset ALL mock call histories including the console.warn spy.
    // (clearAllMocks resets call counts but preserves mock implementations.)
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    queueMocks.hasPendingUserContent.mockReturnValue(true);
  });

  afterEach(async () => {
    // Flush microtasks generated by this test so the next test's spy starts clean.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

  it("emits console.warn and recreates the file when activity file is missing (ENOENT)", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);

    const state = makeState({ lastActivityAt: Date.now() - 120_000 });
    setActivityFile(SID, state);
    touchActivityFile(SID); // fires doTouch → void appendNewline(...)

    // Flush the five-level async chain (appendFile→catch→mkdir→open→close→appendFile)
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("file missing — recreating at registered path"),
    );
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(vi.mocked(open)).toHaveBeenCalledWith(state.filePath, "a", 0o600);
    // appendFile: 1st call (ENOENT) + 1 retry after recreation = 2
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(2);
  });

  it("emits a second console.warn when file recreation itself fails", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.mocked(appendFile).mockRejectedValueOnce(enoentErr);
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("EPERM: permission denied"));

    const state = makeState({ lastActivityAt: Date.now() - 120_000 });
    setActivityFile(SID, state);
    touchActivityFile(SID);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/file missing — recreating/);
    expect(vi.mocked(console.warn).mock.calls[1][0]).toMatch(/recreation failed/);
  });

  it("does not warn and uses a single appendFile call when the file exists (normal touch)", async () => {
    const state = makeState({ lastActivityAt: Date.now() - 120_000 });
    setActivityFile(SID, state);
    touchActivityFile(SID);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(console.warn).not.toHaveBeenCalled();
    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
  });
});
