/**
 * Tests for the activity-file idle-kick state machine (task 10-0876).
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
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock session-manager to control getKickDebounceMs per-test
const sessionMocks = vi.hoisted(() => ({
  getKickDebounceMs: vi.fn((_sid: number): number => 60_000),
}));

vi.mock("../../session-manager.js", () => ({
  getKickDebounceMs: (sid: number) => sessionMocks.getKickDebounceMs(sid),
}));

// Mock fs/promises to avoid real file I/O
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}));

import {
  setActivityFile,
  getActivityFile,
  touchActivityFile,
  recordActivityTouch,
  setDequeueActive,
  replaceActivityFile,
  resetActivityFileStateForTest,
} from "./file-state.js";

const SID = 42;

function makeState(overrides: Partial<{
  lastActivityAt: number;
  inflightDequeue: boolean;
  nudgeArmed: boolean;
}> = {}) {
  return {
    filePath: "/tmp/test-activity-file",
    tmcpOwned: false,
    lastTouchAt: null,
    debounceTimer: null,
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
});
