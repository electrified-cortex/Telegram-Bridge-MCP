import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(() => [] as Array<{ sid: number; name: string; color: string; createdAt: string }>),
  getSessionState: vi.fn(() => undefined as { lastDequeueAt: number | undefined; lastOutboundAt: number | undefined } | undefined),
  hasActiveAnimation: vi.fn(() => false),
  setSilenceHint: vi.fn(),
  getSilenceThreshold: vi.fn(() => 30),
}));

vi.mock("./session-manager.js", () => ({
  listSessions: () => mocks.listSessions(),
  setSilenceHint: (sid: number, hint: string) => mocks.setSilenceHint(sid, hint),
  getSilenceThreshold: (sid: number) => mocks.getSilenceThreshold(sid),
}));

vi.mock("./behavior-tracker.js", () => ({
  getSessionState: (sid: number) => mocks.getSessionState(sid),
}));

vi.mock("./animation-state.js", () => ({
  hasActiveAnimation: (sid: number) => mocks.hasActiveAnimation(sid),
}));

import {
  _runSilenceDetectorTickForTest,
  resetSilenceDetectorForTest,
  setPresenceNudgeInjector,
  setSilenceDetectorOptOut,
  removeSilenceState,
} from "./silence-detector.js";

// ── Helpers ───────────────────────────────────────────────

const NOW = 1_000_000_000;

function makeSession(sid = 1, createdAtMs = NOW - 60_000) {
  return {
    sid,
    name: `Test-${sid}`,
    color: "🟨",
    createdAt: new Date(createdAtMs).toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────

describe("silence-detector", () => {
  const nudge = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetSilenceDetectorForTest();
    setPresenceNudgeInjector(nudge);
    mocks.listSessions.mockReturnValue([makeSession()]);
    // Default: agent dequeued 40s ago, no ack yet
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 40_000, lastOutboundAt: undefined });
    mocks.hasActiveAnimation.mockReturnValue(false);
    mocks.getSilenceThreshold.mockReturnValue(30);
  });

  it("no nudge when no sessions", () => {
    mocks.listSessions.mockReturnValue([]);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge when no dequeue has happened (lastDequeueAt undefined)", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: undefined, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge when agent has already acked after last dequeue", () => {
    // Dequeued at NOW-40s, acked at NOW-10s → window closed
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 40_000, lastOutboundAt: NOW - 10_000 });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge when ack timestamp equals dequeue timestamp", () => {
    // lastOutboundAt === lastDequeueAt → window closed
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 40_000, lastOutboundAt: NOW - 40_000 });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("no nudge when animation is active", () => {
    mocks.hasActiveAnimation.mockReturnValue(true);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge during startup grace period", () => {
    mocks.listSessions.mockReturnValue([makeSession(1, NOW - 10_000)]); // only 10s old
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge when elapsed < threshold (29s)", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 29_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("rung-1 fires envelope hint at threshold (30s)", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(1);
    expect(nudge).not.toHaveBeenCalled(); // rung-1 is NOT a service message anymore
    const [sid, hint] = mocks.setSilenceHint.mock.calls[0] as [number, string];
    expect(sid).toBe(1);
    expect(hint).toContain("35");
    expect(hint).toContain("silence");
  });

  it("rung-1 hint text contains elapsed seconds and dequeue reference", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    const [, hint] = mocks.setSilenceHint.mock.calls[0] as [number, string];
    expect(hint).toMatch(/35s since last dequeue/);
  });

  it("rung-1 does not re-fire on second tick", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    _runSilenceDetectorTickForTest(NOW + 5_000);
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(1);
  });

  it("rung-2 fires service message at 2× threshold (60s)", () => {
    // Tick 1: rung-1 at 35s
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    // Tick 2: rung-2 at 65s
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 65_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW + 30_000);
    expect(nudge).toHaveBeenCalledTimes(1);
    const [, , eventType] = nudge.mock.calls[0] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung2");
  });

  it("rung-2 text contains elapsed seconds", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW); // rung-1
    // Keep same lastDequeueAt; tick advances 30s → elapsed = 65s → rung-2
    _runSilenceDetectorTickForTest(NOW + 30_000); // rung-2 at 65s elapsed
    const [, text] = nudge.mock.calls[0] as [number, string, string];
    expect(text).toContain("65");
  });

  it("rung-2 fires directly if first tick is already past 2× threshold", () => {
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 70_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);
    const [, , eventType] = nudge.mock.calls[0] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung2");
    expect(mocks.setSilenceHint).not.toHaveBeenCalled(); // rung-1 hint skipped
  });

  it("self-clearing: ack after dequeue closes window", () => {
    // Rung-1 fires
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    // Agent acks
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: NOW + 1_000 });
    _runSilenceDetectorTickForTest(NOW + 10_000);
    // Window is closed → no more nudges
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(1);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("new dequeue resets rung state for fresh episode", () => {
    // Episode 1: rung-1 fires
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 35_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    // New dequeue (lastDequeueAt advances) — window briefly closed then open again
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW + 5_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW + 5_000); // only 0s elapsed → no nudge
    // Episode 2: rung-1 fires again 35s after new dequeue
    _runSilenceDetectorTickForTest(NOW + 41_000); // 36s since new dequeue
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(2);
  });

  it("opt-out suppresses nudges", () => {
    setSilenceDetectorOptOut(1, true);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("opt-out re-enable resumes nudges", () => {
    setSilenceDetectorOptOut(1, true);
    setSilenceDetectorOptOut(1, false);
    _runSilenceDetectorTickForTest(NOW);
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(1);
  });

  it("removeSilenceState clears session and allows fresh rung-1", () => {
    // Rung-1 fires
    _runSilenceDetectorTickForTest(NOW);
    // Clear state
    removeSilenceState(1);
    // Fresh state → rung-1 fires again
    _runSilenceDetectorTickForTest(NOW + 5_000);
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(2);
  });

  it("per-session threshold is respected (custom 20s threshold)", () => {
    mocks.getSilenceThreshold.mockReturnValue(20);
    // Dequeued 25s ago — past 20s threshold
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 25_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(mocks.setSilenceHint).toHaveBeenCalledTimes(1);
  });

  it("no nudge when custom threshold not yet reached", () => {
    mocks.getSilenceThreshold.mockReturnValue(20);
    // Dequeued 15s ago — before 20s threshold
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: NOW - 15_000, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });

  it("no nudge on dequeue-idle-wait (empty poll / no lastDequeueAt)", () => {
    // Simulate: agent has been polling empty queue; lastDequeueAt never set
    mocks.getSessionState.mockReturnValue({ lastDequeueAt: undefined, lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
    expect(mocks.setSilenceHint).not.toHaveBeenCalled();
  });
});
