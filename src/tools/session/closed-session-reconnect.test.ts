/**
 * Tests for AC2 and AC3: closed-session marker rejection in
 * handleSessionReconnect() and handleSessionStart() (refresh: true).
 *
 * These tests verify that presenting a connection_token that belongs to a
 * closed session causes immediate rejection with CALLER_CLOSED before any
 * operator approval dialog is shown.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { isError, errorCode } from "../test-utils.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  pinChatMessage: vi.fn().mockResolvedValue(undefined),
  dequeue: vi.fn().mockReturnValue(undefined),
  createSession: vi.fn(),
  closeSession: vi.fn(),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  activeSessionCount: vi.fn().mockReturnValue(0),
  getSession: vi.fn(),
  getAvailableColors: vi.fn().mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]),
  setGovernorSid: vi.fn(),
  getGovernorSid: vi.fn().mockReturnValue(0),
  deliverServiceMessage: vi.fn(),
  deliverReminderEvent: vi.fn().mockReturnValue(true),
  trackMessageOwner: vi.fn(),
  drainQueue: vi.fn().mockReturnValue([]),
  getSessionQueue: vi.fn().mockReturnValue({ pendingCount: () => 0 }),
  setSessionAnnouncementMessage: vi.fn(),
  getSessionAnnouncementMessage: vi.fn().mockReturnValue(undefined),
  setSessionReauthDialogMsgId: vi.fn(),
  clearSessionReauthDialogMsgId: vi.fn(),
  resolveChat: vi.fn(() => 42),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  startPoller: vi.fn(),
  isPollerRunning: vi.fn().mockReturnValue(false),
  checkAndConsumeAutoApprove: vi.fn().mockReturnValue(false),
  registerPendingApproval: vi.fn(),
  clearPendingApproval: vi.fn(),
  validateSession: vi.fn().mockReturnValue(false),
  readProfile: vi.fn((_key: string): Record<string, unknown> | null => null),
  applyProfile: vi.fn((_sid: number, _profile: unknown): { applied: Record<string, unknown> } => ({ applied: {} })),
  isClosedMarker: vi.fn().mockReturnValue(false),
  resetNotifyGateState: vi.fn(),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      editMessageReplyMarkup: mocks.editMessageReplyMarkup,
      deleteMessage: mocks.deleteMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      pinChatMessage: mocks.pinChatMessage,
    }),
    resolveChat: () => mocks.resolveChat(),
  };
});

vi.mock("../../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: vi.fn().mockReturnValue(0),
  dequeue: mocks.dequeue,
  registerCallbackHook: mocks.registerCallbackHook,
  clearCallbackHook: mocks.clearCallbackHook,
}));

vi.mock("../../session-manager.js", () => ({
  createSession: mocks.createSession,
  closeSession: mocks.closeSession,
  setActiveSession: mocks.setActiveSession,
  listSessions: mocks.listSessions,
  activeSessionCount: () => mocks.activeSessionCount(),
  getSession: mocks.getSession,
  getAvailableColors: mocks.getAvailableColors,
  COLOR_PALETTE: ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"],
  setSessionAnnouncementMessage: mocks.setSessionAnnouncementMessage,
  getSessionAnnouncementMessage: mocks.getSessionAnnouncementMessage,
  setSessionReauthDialogMsgId: mocks.setSessionReauthDialogMsgId,
  clearSessionReauthDialogMsgId: mocks.clearSessionReauthDialogMsgId,
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
  isClosedMarker: (token: string) => mocks.isClosedMarker(token),
}));

vi.mock("../../routing-mode.js", () => ({
  setGovernorSid: mocks.setGovernorSid,
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../../built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: vi.fn() };
});

vi.mock("../../session-queue.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    createSessionQueue: vi.fn(),
    removeSessionQueue: vi.fn(),
    deliverServiceMessage: mocks.deliverServiceMessage,
    deliverReminderEvent: (...args: unknown[]) => mocks.deliverReminderEvent(...args),
    trackMessageOwner: mocks.trackMessageOwner,
    drainQueue: mocks.drainQueue,
    getSessionQueue: (...args: unknown[]) => mocks.getSessionQueue(...args),
  };
});

vi.mock("../../poller.js", () => ({
  startPoller: (...args: unknown[]) => mocks.startPoller(...args),
  isPollerRunning: () => mocks.isPollerRunning(),
}));

vi.mock("../../auto-approve.js", () => ({
  checkAndConsumeAutoApprove: () => mocks.checkAndConsumeAutoApprove(),
}));

vi.mock("../../agent-approval.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    registerPendingApproval: (...args: unknown[]) => mocks.registerPendingApproval(...args),
    clearPendingApproval: (...args: unknown[]) => mocks.clearPendingApproval(...args),
  };
});

vi.mock("../../profile-store.js", () => ({
  readProfile: (key: string) => mocks.readProfile(key),
}));

vi.mock("../profile/apply.js", () => ({
  applyProfile: (sid: number, profile: unknown) => mocks.applyProfile(sid, profile),
}));

vi.mock("../../tools/activity/file-state.js", () => ({
  resetNotifyGateState: (...args: unknown[]) => mocks.resetNotifyGateState(...args),
}));

import { handleSessionReconnect, handleSessionStart } from "./start.js";
import { resetReminderStateForTest } from "../../reminder-state.js";
import { setDelegationEnabled } from "../../agent-approval.js";

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Closed-session rejection — AC2: handleSessionReconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReminderStateForTest();
    setDelegationEnabled(false);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);
    mocks.isClosedMarker.mockReturnValue(false);
    mocks.readProfile.mockReturnValue(null);
    mocks.applyProfile.mockReturnValue({ applied: {} });
  });

  it("rejects with CALLER_CLOSED when connection_token matches a closed marker", async () => {
    const closedToken = "dead-beef-uuid";
    mocks.isClosedMarker.mockReturnValue(true);

    const result = await handleSessionReconnect({ name: "Worker", connection_token: closedToken });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLER_CLOSED");
    // Must NOT show the operator dialog (no sendMessage call)
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
  });

  it("checks isClosedMarker with the provided connection_token value", async () => {
    const closedToken = "specific-token-value";
    mocks.isClosedMarker.mockReturnValue(true);

    await handleSessionReconnect({ name: "Worker", connection_token: closedToken });

    expect(mocks.isClosedMarker).toHaveBeenCalledWith(closedToken);
  });

  it("proceeds to approval dialog when connection_token has no closed marker", async () => {
    const liveToken = "live-token-uuid";
    mocks.isClosedMarker.mockReturnValue(false); // not closed
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Worker", createdAt: "2026-06-01" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, suffix: 111111, name: "Worker", color: "🟦",
      createdAt: "2026-06-01", lastPollAt: undefined, healthy: true,
      connectionToken: liveToken,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 99 });
    // Simulate operator denial — we just want to confirm the dialog was shown
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_no", qid: "q1" } }); });
    });

    const result = await handleSessionReconnect({ name: "Worker", connection_token: liveToken });

    // Dialog was shown (sendMessage called)
    expect(mocks.sendMessage).toHaveBeenCalled();
    // Result is SESSION_DENIED from the operator dialog (not CALLER_CLOSED)
    expect(errorCode(result)).toBe("SESSION_DENIED");
  });

  it("proceeds normally when no connection_token is provided (backward-compat)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Alpha", createdAt: "2026-06-01" }]);
    mocks.getSession.mockReturnValue({
      sid: 2, suffix: 222222, name: "Alpha", color: "🟩",
      createdAt: "2026-06-01", lastPollAt: undefined, healthy: true,
      connectionToken: "some-token",
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 100 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_no", qid: "q2" } }); });
    });

    await handleSessionReconnect({ name: "Alpha" }); // no connection_token

    // isClosedMarker should NOT have been called (no token to check)
    expect(mocks.isClosedMarker).not.toHaveBeenCalled();
  });
});

describe("Closed-session rejection — AC3: handleSessionStart with refresh:true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReminderStateForTest();
    setDelegationEnabled(false);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);
    mocks.isClosedMarker.mockReturnValue(false);
    mocks.readProfile.mockReturnValue(null);
    mocks.applyProfile.mockReturnValue({ applied: {} });
    mocks.createSession.mockReturnValue({
      sid: 1, suffix: 100001, name: "Primary", color: "🟦", sessionsActive: 1,
      connectionToken: "new-session-token",
    });
  });

  it("rejects with CALLER_CLOSED on refresh:true when connection_token has a closed marker", async () => {
    const closedToken = "dead-token-refresh";
    mocks.isClosedMarker.mockReturnValue(true);

    const result = await handleSessionStart({
      name: "Primary",
      refresh: true,
      connection_token: closedToken,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLER_CLOSED");
    // Must NOT show the operator dialog
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    // Must NOT create a session
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("checks isClosedMarker with the provided connection_token value", async () => {
    const closedToken = "specific-refresh-token";
    mocks.isClosedMarker.mockReturnValue(true);

    await handleSessionStart({ name: "Primary", refresh: true, connection_token: closedToken });

    expect(mocks.isClosedMarker).toHaveBeenCalledWith(closedToken);
  });

  it("does NOT reject when refresh:true but no connection_token", async () => {
    mocks.isClosedMarker.mockReturnValue(true); // would reject if token was checked

    const result = await handleSessionStart({ name: "Primary", refresh: true });

    // isClosedMarker should NOT have been called (no connection_token to check)
    expect(mocks.isClosedMarker).not.toHaveBeenCalled();
    // Session proceeds normally
    expect(mocks.createSession).toHaveBeenCalled();
    expect(isError(result)).toBe(false);
  });

  it("does NOT reject when connection_token provided but refresh is false/omitted", async () => {
    const closedToken = "token-no-refresh";
    mocks.isClosedMarker.mockReturnValue(true);

    const result = await handleSessionStart({ name: "Primary", connection_token: closedToken });

    // Without refresh:true, the closed-marker check is skipped
    expect(mocks.isClosedMarker).not.toHaveBeenCalled();
    // Session is created normally
    expect(mocks.createSession).toHaveBeenCalled();
    expect(isError(result)).toBe(false);
  });

  it("proceeds normally on refresh:true when connection_token has no closed marker", async () => {
    const liveToken = "live-refresh-token";
    mocks.isClosedMarker.mockReturnValue(false); // not closed

    const result = await handleSessionStart({
      name: "Primary",
      refresh: true,
      connection_token: liveToken,
    });

    expect(mocks.isClosedMarker).toHaveBeenCalledWith(liveToken);
    // Not rejected
    expect(isError(result)).toBe(false);
    expect(mocks.createSession).toHaveBeenCalled();
  });
});
