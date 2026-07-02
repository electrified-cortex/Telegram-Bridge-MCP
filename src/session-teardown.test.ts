/**
 * Tests for session-teardown.ts — silent_lifecycle profile flag.
 *
 * AC3: When silent_lifecycle: true, the public "has disconnected" Telegram
 *      chat message is suppressed on graceful session close.
 * AC4: Internal deliverServiceMessage (dequeue-side session_closed signals)
 *      are NOT suppressed — other sessions still get notified internally.
 * AC5: Default profile (no flag / flag absent) preserves existing behavior.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // telegram.js
  sendServiceMessage: vi.fn().mockResolvedValue(undefined),
  resolveChat: vi.fn().mockReturnValue(1001),
  unpinChatMessage: vi.fn().mockResolvedValue(undefined),

  // profile-store.js (new dependency)
  readProfile: vi.fn().mockReturnValue(null),

  // session-manager.js
  closeSession: vi.fn().mockReturnValue(true),
  getSession: vi.fn(),
  getActiveSession: vi.fn().mockReturnValue(0),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  activeSessionCount: vi.fn().mockReturnValue(0),
  getSessionAnnouncementMessage: vi.fn().mockReturnValue(undefined),

  // session-queue.js
  removeSessionQueue: vi.fn(),
  drainQueue: vi.fn().mockReturnValue([]),
  deliverDirectMessage: vi.fn(),
  deliverServiceMessage: vi.fn(),
  routeToSession: vi.fn(),

  // routing-mode.js
  getGovernorSid: vi.fn().mockReturnValue(0),
  setGovernorSid: vi.fn(),

  // message-store.js
  replaceSessionCallbackHooks: vi.fn(),

  // dm-permissions.js
  revokeAllForSession: vi.fn(),

  // poller.js
  stopPoller: vi.fn(),

  // reminder-state.js
  clearSessionReminders: vi.fn(),

  // animation-state.js
  cancelAnimation: vi.fn().mockResolvedValue(undefined),

  // child-registry.js
  getChildSids: vi.fn().mockReturnValue([]),
  unregisterChild: vi.fn(),

  // sse-endpoint.js
  cancelSseConnection: vi.fn(),

  // tools/activity/file-state.js (additional)
  isSseMonitorActive: vi.fn().mockReturnValue(false),

  // tools/dequeue.js (additional — 10-3028)
  removeDequeuePatternNudgeState: vi.fn(),

  // tools/dequeue.js (additional — 30-2205)
  removeColdDequeueState: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("./telegram.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    sendServiceMessage: (...args: unknown[]) => mocks.sendServiceMessage(...args),
    resolveChat: () => mocks.resolveChat(),
    getApi: () => ({ unpinChatMessage: mocks.unpinChatMessage }),
  };
});

vi.mock("./profile-store.js", () => ({
  readProfile: (key: string) => mocks.readProfile(key),
}));

vi.mock("./session-manager.js", () => ({
  closeSession: mocks.closeSession,
  getSession: (...args: unknown[]) => mocks.getSession(...args),
  getActiveSession: () => mocks.getActiveSession(),
  setActiveSession: mocks.setActiveSession,
  listSessions: mocks.listSessions,
  activeSessionCount: () => mocks.activeSessionCount(),
  getSessionAnnouncementMessage: (...args: unknown[]) => mocks.getSessionAnnouncementMessage(...args),
}));

vi.mock("./session-queue.js", () => ({
  removeSessionQueue: mocks.removeSessionQueue,
  drainQueue: mocks.drainQueue,
  deliverDirectMessage: mocks.deliverDirectMessage,
  deliverServiceMessage: mocks.deliverServiceMessage,
  routeToSession: mocks.routeToSession,
}));

vi.mock("./routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
  setGovernorSid: mocks.setGovernorSid,
}));

vi.mock("./message-store.js", () => ({
  replaceSessionCallbackHooks: mocks.replaceSessionCallbackHooks,
}));

vi.mock("./dm-permissions.js", () => ({
  revokeAllForSession: mocks.revokeAllForSession,
}));

vi.mock("./poller.js", () => ({
  stopPoller: mocks.stopPoller,
}));

vi.mock("./reminder-state.js", () => ({
  clearSessionReminders: mocks.clearSessionReminders,
}));

vi.mock("./animation-state.js", () => ({
  cancelAnimation: mocks.cancelAnimation,
}));

// These modules are safe to use real implementations for (no side effects on empty state)
vi.mock("./async-send-queue.js", () => ({ cancelSessionJobs: vi.fn() }));
vi.mock("./behavior-tracker.js", () => ({ removeSession: vi.fn() }));
vi.mock("./silence-detector.js", () => ({ removeSilenceState: vi.fn() }));
vi.mock("./tools/activity/file-state.js", () => ({
  clearActivityFile: vi.fn().mockResolvedValue(undefined),
  isSseMonitorActive: (...args: unknown[]) => mocks.isSseMonitorActive(...args),
}));
vi.mock("./sse-endpoint.js", () => ({
  cancelSseConnection: (...args: unknown[]) => mocks.cancelSseConnection(...args),
}));
vi.mock("./channel.js", () => ({ unregisterChannelSubscriber: vi.fn() }));
vi.mock("./tools/dequeue.js", () => ({
  removeDequeueRateState: vi.fn(),
  removeMaxWait0State: vi.fn(),
  removeDequeuePatternNudgeState: (...args: unknown[]) => mocks.removeDequeuePatternNudgeState(...args),
  removeColdDequeueState: (...args: unknown[]) => mocks.removeColdDequeueState(...args),
}));
vi.mock("./tools/session/child-registry.js", () => ({
  getChildSids: (...args: unknown[]) => mocks.getChildSids(...args),
  unregisterChild: (...args: unknown[]) => mocks.unregisterChild(...args),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { closeSessionById } from "./session-teardown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupRootSession(name = "SilentBot") {
  mocks.getSession.mockReturnValue({ name, parent_sid: undefined });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-teardown: silent_lifecycle profile flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.readProfile.mockReturnValue(null);
    mocks.closeSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.drainQueue.mockReturnValue([]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    mocks.getChildSids.mockReturnValue([]);
    setupRootSession();
  });

  // ── AC3: suppressed close announcement ──────────────────────────────────

  it("AC3: suppresses 'has disconnected' sendServiceMessage when silent_lifecycle: true", () => {
    mocks.readProfile.mockReturnValue({ silent_lifecycle: true });

    closeSessionById(1);

    expect(mocks.sendServiceMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("AC3: profile key is the session name (not SID)", () => {
    setupRootSession("SpecificName");
    mocks.readProfile.mockReturnValue({ silent_lifecycle: true });

    closeSessionById(5);

    expect(mocks.readProfile).toHaveBeenCalledWith("SpecificName");
  });

  it("AC3: readProfile errors are handled gracefully — falls back to announce", () => {
    mocks.readProfile.mockImplementation(() => { throw new Error("disk error"); });

    // Should not throw, and should fall back to announcing (safe default)
    expect(() => closeSessionById(1)).not.toThrow();
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  // ── AC4: internal deliverServiceMessage unaffected ───────────────────────

  it("AC4: deliverServiceMessage (dequeue-side SESSION_CLOSED) still fires when silent_lifecycle: true", () => {
    mocks.readProfile.mockReturnValue({ silent_lifecycle: true });
    // A remaining session exists so SESSION_CLOSED is delivered internally
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Curator", createdAt: "2026-01-01" }]);
    mocks.getGovernorSid.mockReturnValue(99); // sid 1 was NOT the governor

    closeSessionById(1);

    // Internal dequeue notification is not suppressed
    expect(mocks.deliverServiceMessage).toHaveBeenCalled();
    // But the public disconnect announcement IS suppressed
    expect(mocks.sendServiceMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("AC4: sub-sessions skip disconnect announcement regardless of silent_lifecycle (parent_sid set)", () => {
    mocks.getSession.mockReturnValue({ name: "Child", parent_sid: 1 }); // sub-session
    mocks.readProfile.mockReturnValue(null); // no profile

    closeSessionById(2);

    // Sub-sessions are already suppressed — this tests the existing guard is not broken
    expect(mocks.sendServiceMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  // ── AC5: default — no behavior change when flag absent ───────────────────

  it("AC5: sends 'has disconnected' when no profile exists (default behavior)", () => {
    mocks.readProfile.mockReturnValue(null);

    closeSessionById(1);

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("AC5: sends 'has disconnected' when profile exists but has no silent_lifecycle field", () => {
    mocks.readProfile.mockReturnValue({ autoload: true, voice: "nova" });

    closeSessionById(1);

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("AC5: sends 'has disconnected' when profile has silent_lifecycle: false", () => {
    mocks.readProfile.mockReturnValue({ silent_lifecycle: false });

    closeSessionById(1);

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  // ── Structural: readProfile is called with the right key ──────────────────

  it("reads profile by session name at close time (emission-time reads)", () => {
    setupRootSession("BotPod");

    closeSessionById(7);

    expect(mocks.readProfile).toHaveBeenCalledWith("BotPod");
  });

  it("does not read profile for sub-sessions (parent_sid set)", () => {
    mocks.getSession.mockReturnValue({ name: "child", parent_sid: 1 });

    closeSessionById(3);

    // readProfile is guarded behind the parent_sid check — should NOT be called
    // (since the whole block is gated on !sessionInfo?.parent_sid)
    expect(mocks.readProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC1: Cascade teardown emits child_session_resolved to parent
// ---------------------------------------------------------------------------

describe("session-teardown: cascade close emits child_session_resolved (AC1)", () => {
  const PARENT_SID = 10;
  const CHILD_SID = 20;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.drainQueue.mockReturnValue([]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    mocks.readProfile.mockReturnValue(null);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.cancelAnimation.mockResolvedValue(undefined);
    // Default: no children
    mocks.getChildSids.mockReturnValue([]);
    // Default: parent session (root, no parent_sid)
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      return undefined;
    });
  });

  it("AC1: emits child_session_resolved to parent for each child in cascade", () => {
    mocks.getChildSids.mockImplementation((sid: number) => sid === PARENT_SID ? [CHILD_SID] : []);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      if (sid === CHILD_SID) return { name: "ChildBot", parent_sid: PARENT_SID, exit_status: "resolved" };
      return undefined;
    });

    closeSessionById(PARENT_SID);

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.stringContaining("ChildBot"),
      "child_session_resolved",
      expect.objectContaining({ child_sid: CHILD_SID, child_name: "ChildBot", exit_status: "resolved" }),
    );
  });

  it("AC1: payload uses empty exit_status when child has no exit_status field", () => {
    mocks.getChildSids.mockImplementation((sid: number) => sid === PARENT_SID ? [CHILD_SID] : []);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      if (sid === CHILD_SID) return { name: "ChildBot", parent_sid: PARENT_SID };  // no exit_status
      return undefined;
    });

    closeSessionById(PARENT_SID);

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.any(String),
      "child_session_resolved",
      expect.objectContaining({ exit_status: "" }),
    );
  });

  it("AC1: no emission when child session is not found (already closed)", () => {
    // Only the parent has a child; the child itself has no sub-children
    mocks.getChildSids.mockImplementation((sid: number) => sid === PARENT_SID ? [CHILD_SID] : []);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      return undefined; // child not found — session already gone
    });

    closeSessionById(PARENT_SID);

    const childResolvedCalls = (mocks.deliverServiceMessage.mock.calls as unknown[]).filter(
      (c) => (c as unknown[])[2] === "child_session_resolved",
    );
    expect(childResolvedCalls).toHaveLength(0);
  });

  it("AC1: emits for each child when parent has multiple children", () => {
    const CHILD_SID_2 = 21;
    mocks.getChildSids.mockImplementation((sid: number) => sid === PARENT_SID ? [CHILD_SID, CHILD_SID_2] : []);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      if (sid === CHILD_SID) return { name: "ChildA", parent_sid: PARENT_SID };
      if (sid === CHILD_SID_2) return { name: "ChildB", parent_sid: PARENT_SID };
      return undefined;
    });

    closeSessionById(PARENT_SID);

    const childResolvedCalls = (mocks.deliverServiceMessage.mock.calls as unknown[]).filter(
      (c) => (c as unknown[])[2] === "child_session_resolved",
    );
    expect(childResolvedCalls).toHaveLength(2);
  });

  it("AC1: emits child_session_resolved BEFORE closing child session (call ordering)", () => {
    const callOrder: string[] = [];
    mocks.deliverServiceMessage.mockImplementation(() => { callOrder.push("deliver"); return true; });
    mocks.closeSession.mockImplementation(() => { callOrder.push("close"); return true; });

    mocks.getChildSids.mockImplementation((sid: number) => sid === PARENT_SID ? [CHILD_SID] : []);
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { name: "Parent", parent_sid: undefined };
      if (sid === CHILD_SID) return { name: "ChildBot", parent_sid: PARENT_SID };
      return undefined;
    });

    closeSessionById(PARENT_SID);

    const deliverIdx = callOrder.indexOf("deliver");
    const firstCloseIdx = callOrder.indexOf("close");
    expect(deliverIdx).not.toBe(-1);
    expect(firstCloseIdx).not.toBe(-1);
    // The deliver call for the child must come before the first closeSession call
    expect(deliverIdx).toBeLessThan(firstCloseIdx);
  });

  it("AC1: does not emit child_session_resolved for sessions without children", () => {
    mocks.getChildSids.mockReturnValue([]);

    closeSessionById(PARENT_SID);

    const childResolvedCalls = (mocks.deliverServiceMessage.mock.calls as unknown[]).filter(
      (c) => (c as unknown[])[2] === "child_session_resolved",
    );
    expect(childResolvedCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10-3026: Cancel SSE connection on session close
// ---------------------------------------------------------------------------

describe("session-teardown: SSE cancel on session close (10-3026)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.drainQueue.mockReturnValue([]);
    mocks.getChildSids.mockReturnValue([]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    mocks.readProfile.mockReturnValue(null);
    mocks.isSseMonitorActive.mockReturnValue(false);
    mocks.getSession.mockReturnValue({ name: "TestBot", parent_sid: undefined });
  });

  it("calls cancelSseConnection when isSseMonitorActive returns true", () => {
    mocks.isSseMonitorActive.mockReturnValue(true);

    closeSessionById(42);

    expect(mocks.cancelSseConnection).toHaveBeenCalledWith(42);
  });

  it("does NOT call cancelSseConnection when isSseMonitorActive returns false", () => {
    mocks.isSseMonitorActive.mockReturnValue(false);

    closeSessionById(42);

    expect(mocks.cancelSseConnection).not.toHaveBeenCalled();
  });

  it("isSseMonitorActive is checked with the correct sid", () => {
    mocks.isSseMonitorActive.mockReturnValue(false);

    closeSessionById(99);

    expect(mocks.isSseMonitorActive).toHaveBeenCalledWith(99);
  });
});

// ---------------------------------------------------------------------------
// 10-3028: dequeue-pattern nudge state cleared on session close
// ---------------------------------------------------------------------------

describe("session-teardown — 10-3028 cleanup on session close", () => {
  const TEST_SID = 55;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.drainQueue.mockReturnValue([]);
    mocks.getChildSids.mockReturnValue([]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    mocks.readProfile.mockReturnValue(null);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.cancelAnimation.mockResolvedValue(undefined);
    mocks.isSseMonitorActive.mockReturnValue(false);
    mocks.getSession.mockReturnValue({ name: "TestBot", parent_sid: undefined });
  });

  it("calls removeDequeuePatternNudgeState with the correct sid on session teardown", () => {
    closeSessionById(TEST_SID);

    expect(mocks.removeDequeuePatternNudgeState).toHaveBeenCalledWith(TEST_SID);
  });

  it("calls removeDequeuePatternNudgeState exactly once per closeSessionById call", () => {
    closeSessionById(TEST_SID);

    expect(mocks.removeDequeuePatternNudgeState).toHaveBeenCalledTimes(1);
  });

  it("does not call removeDequeuePatternNudgeState when session does not exist (closeSession returns false)", () => {
    mocks.closeSession.mockReturnValue(false);

    closeSessionById(TEST_SID);

    expect(mocks.removeDequeuePatternNudgeState).not.toHaveBeenCalled();
  });

  it("calls removeColdDequeueState with the correct sid on session teardown (30-2205)", () => {
    closeSessionById(TEST_SID);

    expect(mocks.removeColdDequeueState).toHaveBeenCalledWith(TEST_SID);
  });

  it("calls removeColdDequeueState exactly once per closeSessionById call", () => {
    closeSessionById(TEST_SID);

    expect(mocks.removeColdDequeueState).toHaveBeenCalledTimes(1);
  });

  it("does not call removeColdDequeueState when session does not exist (closeSession returns false)", () => {
    mocks.closeSession.mockReturnValue(false);

    closeSessionById(TEST_SID);

    expect(mocks.removeColdDequeueState).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC3-regression: poller must NOT be stopped when last session closes
//
// Root cause (10-3031): session-teardown.ts called stopPoller() when
// activeSessionCount() reached 0. This killed the Telegram poll loop, making
// /shutdown a silent no-op in the empty-roster state — the update was never
// received. Fix: removed the stopPoller() call; the poller is lifecycle-owned
// by index.ts (started unconditionally, stopped only by the shutdown sequence).
// ---------------------------------------------------------------------------

describe("session-teardown: poller is NOT stopped when last session closes (AC3-regression 10-3031)", () => {
  const TEST_SID = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.activeSessionCount.mockReturnValue(0); // last session just closed
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.drainQueue.mockReturnValue([]);
    mocks.getChildSids.mockReturnValue([]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    mocks.readProfile.mockReturnValue(null);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.cancelAnimation.mockResolvedValue(undefined);
    mocks.isSseMonitorActive.mockReturnValue(false);
    mocks.getSession.mockReturnValue({ name: "LastSession", parent_sid: undefined });
  });

  it("does not call stopPoller when the last session closes (empty roster must keep poller alive for /shutdown)", () => {
    closeSessionById(TEST_SID);

    // stopPoller must NOT be called — the poller is the only path through which
    // the operator can send /shutdown to an otherwise-idle bridge. Stopping it
    // on last-session-close caused /shutdown to silently no-op (AC1 regression).
    expect(mocks.stopPoller).not.toHaveBeenCalled();
  });
});
