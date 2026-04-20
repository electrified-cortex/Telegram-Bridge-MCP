import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(() => [] as Array<{ sid: number; name: string; color: string; createdAt: string }>),
  getSessionState: vi.fn(() => undefined as { lastOutboundAt: number | undefined } | undefined),
  hasPendingUserContent: vi.fn(() => false),
  getPendingUserContentSince: vi.fn(() => undefined as number | undefined),
  hasActiveAnimation: vi.fn(() => false),
}));

vi.mock("./session-manager.js", () => ({
  listSessions: () => mocks.listSessions(),
}));

vi.mock("./behavior-tracker.js", () => ({
  getSessionState: (sid: number) => mocks.getSessionState(sid),
}));

vi.mock("./session-queue.js", () => ({
  hasPendingUserContent: (sid: number) => mocks.hasPendingUserContent(sid),
  getPendingUserContentSince: (sid: number) => mocks.getPendingUserContentSince(sid),
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
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: undefined });
    mocks.hasPendingUserContent.mockReturnValue(true);
    mocks.getPendingUserContentSince.mockReturnValue(undefined);
    mocks.hasActiveAnimation.mockReturnValue(false);
  });

  it("no nudge when no sessions", () => {
    mocks.listSessions.mockReturnValue([]);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("no nudge when no pending user content", () => {
    mocks.hasPendingUserContent.mockReturnValue(false);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("no nudge when animation is active", () => {
    mocks.hasActiveAnimation.mockReturnValue(true);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("no nudge during startup grace period", () => {
    mocks.listSessions.mockReturnValue([makeSession(1, NOW - 10_000)]); // only 10s old
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("no nudge when elapsed < 30s", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 20_000 }); // 20s ago
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rung-1 fires at 30s threshold", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 }); // 35s ago
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);
    const [, , eventType] = nudge.mock.calls[0] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung1");
  });

  it("rung-1 text contains elapsed seconds", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW);
    const [, text] = nudge.mock.calls[0] as [number, string, string];
    expect(text).toContain("35");
  });

  it("rung-1 does not re-fire on second tick", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW);
    _runSilenceDetectorTickForTest(NOW + 5_000);
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("rung-2 fires at 60s threshold", () => {
    // First tick: rung-1 at 35s
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW);
    // Second tick: rung-2 at 65s
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 65_000 });
    _runSilenceDetectorTickForTest(NOW + 30_000);
    expect(nudge).toHaveBeenCalledTimes(2);
    const [, , eventType] = nudge.mock.calls[1] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung2");
  });

  it("rung-2 text names working and thinking presets", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW); // rung-1
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 65_000 });
    _runSilenceDetectorTickForTest(NOW + 30_000); // rung-2
    const [, text] = nudge.mock.calls[1] as [number, string, string];
    expect(text).toContain("working");
    expect(text).toContain("thinking");
  });

  it("self-clearing: signal resets rung state", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW); // rung-1 fires
    // Simulate outbound signal: lastOutboundAt advances
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW + 1_000 });
    _runSilenceDetectorTickForTest(NOW + 10_000); // elapsed < 30s now, no nudge
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("self-clearing allows new episode after signal", () => {
    // Episode 1: rung-1 fires
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW);
    // Signal resets episode
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW + 1_000 });
    _runSilenceDetectorTickForTest(NOW + 5_000);
    // Episode 2: rung-1 fires again after 35s silence
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW + 1_000 });
    _runSilenceDetectorTickForTest(NOW + 37_000); // 36s since signal
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it("opt-out suppresses nudges", () => {
    setSilenceDetectorOptOut(1, true);
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 70_000 });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("opt-out re-enable resumes nudges", () => {
    setSilenceDetectorOptOut(1, true);
    setSilenceDetectorOptOut(1, false);
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("removeSilenceState clears session and allows fresh rung-1", () => {
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    _runSilenceDetectorTickForTest(NOW); // rung-1 fires
    removeSilenceState(1);
    _runSilenceDetectorTickForTest(NOW + 5_000); // fresh state → rung-1 fires again
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it("fallback to session createdAt when lastOutboundAt is undefined", () => {
    // Session created 35s ago, no outbound signal recorded yet
    mocks.listSessions.mockReturnValue([makeSession(1, NOW - 35_000)]);
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: undefined });
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);
    const [, , eventType] = nudge.mock.calls[0] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung1");
  });

  // ── Grace window tests (AC#1 and AC#2 from 10-777) ─────────────────────────

  it("new inbound message grants fresh 30s grace window even after long silence", () => {
    // Last outbound was 45s ago — without the fix, rung-1 would fire immediately.
    // New operator message arrived just 5s ago → base anchors to pendingSince.
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 45_000 });
    mocks.getPendingUserContentSince.mockReturnValue(NOW - 5_000); // pending 5s
    _runSilenceDetectorTickForTest(NOW);
    // Elapsed from pendingSince = 5s < 30s threshold → no nudge
    expect(nudge).not.toHaveBeenCalled();
  });

  it("clock still advances from last outbound when no fresh inbound resets it", () => {
    // Last outbound 35s ago; pendingSince is older than lastOutboundAt (or undefined).
    // max(lastOutboundAt, pendingSince) = lastOutboundAt → rung-1 fires normally.
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    mocks.getPendingUserContentSince.mockReturnValue(NOW - 60_000); // older than outbound
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);
    const [, , eventType] = nudge.mock.calls[0] as [number, string, string];
    expect(eventType).toBe("behavior_nudge_presence_rung1");
  });

  it("resets grace window when new inbound arrives (AC-a)", () => {
    // Agent last responded 100s ago (would fire rung-2 without fix).
    // Operator message arrived 5s ago — fresh 30 s window applies.
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 100_000 });
    mocks.getPendingUserContentSince.mockReturnValue(NOW - 5_000);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rung resets after new inbound allows a fresh episode", () => {
    // Tick 1: establish baseline pendingSince (old message 100s ago) — rung-1 fires at 35s silence
    mocks.getSessionState.mockReturnValue({ lastOutboundAt: NOW - 35_000 });
    mocks.getPendingUserContentSince.mockReturnValue(NOW - 100_000);
    _runSilenceDetectorTickForTest(NOW);
    expect(nudge).toHaveBeenCalledTimes(1);

    // Tick 2: operator sends NEW message (pendingSince advances) — rung resets, fresh 0s window
    mocks.getPendingUserContentSince.mockReturnValue(NOW + 5_000);
    _runSilenceDetectorTickForTest(NOW + 5_000);
    expect(nudge).toHaveBeenCalledTimes(1); // still 1 — fresh window

    // Tick 3: 36s after new inbound — rung-1 fires again
    _runSilenceDetectorTickForTest(NOW + 41_000);
    expect(nudge).toHaveBeenCalledTimes(2);
  });

});
