/**
 * Tests for the activity-file idle-kick state machine (task 10-0876).
 *
 * Covers:
 *   1. Nudge fires immediately when agent has been silent >= debounce window
 *   2. Nudge is suppressed when agent was recently active (< debounce window)
 *   3. Timer schedules and fires after remaining suppression window
 *   4. recordActivityTouch clears pending timer and resets suppression window
 *   5. Nudge does not fire while dequeue is in-flight (inflightDequeue)
 *   6. Multiple messages in one cycle produce exactly one nudge (one-nudge-per-cycle)
 *   7. setDequeueActive(false) re-arms cycle; subsequent message can nudge again
 *   8. Per-session debounce override is respected (getKickDebounceMs)
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
    absorbedCount: 0,
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

  it("4: recordActivityTouch clears pending timer and resets suppression window", () => {
    sessionMocks.getKickDebounceMs.mockReturnValue(10_000);
    const state = makeState({ lastActivityAt: Date.now() - 3_000 });
    setActivityFile(SID, state);

    touchActivityFile(SID); // schedules timer (3s elapsed of 10s window)

    const entryBefore = getActivityFile(SID)!;
    expect(entryBefore.debounceTimer).not.toBeNull();

    recordActivityTouch(SID); // agent is active — cancel timer

    const entryAfter = getActivityFile(SID)!;
    expect(entryAfter.debounceTimer).toBeNull();       // timer cancelled
    expect(entryAfter.lastActivityAt).toBeGreaterThan(0);

    // Advance past the original window — no nudge should fire
    vi.advanceTimersByTime(15_000);
    expect(getActivityFile(SID)!.lastTouchAt).toBeNull();
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
});
