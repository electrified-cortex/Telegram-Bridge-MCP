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
vi.mock("./tools/activity/file-state.js", () => ({ clearActivityFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./channel.js", () => ({ unregisterChannelSubscriber: vi.fn() }));
vi.mock("./tools/dequeue.js", () => ({ removeDequeueRateState: vi.fn() }));
vi.mock("./tools/session/child-registry.js", () => ({
  getChildSids: vi.fn().mockReturnValue([]),
  unregisterChild: vi.fn(),
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
