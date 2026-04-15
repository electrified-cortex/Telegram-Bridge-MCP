import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  pinChatMessage: vi.fn().mockResolvedValue(undefined),
  pendingCount: vi.fn(),
  dequeue: vi.fn(),
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
  resolveChat: vi.fn(() => 42 as number),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  startPoller: vi.fn(),
  isPollerRunning: vi.fn().mockReturnValue(false),
  checkAndConsumeAutoApprove: vi.fn().mockReturnValue(false),
  registerPendingApproval: vi.fn(),
  clearPendingApproval: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
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

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: mocks.pendingCount,
  dequeue: mocks.dequeue,
  registerCallbackHook: mocks.registerCallbackHook,
  clearCallbackHook: mocks.clearCallbackHook,
}));

vi.mock("../session-manager.js", () => ({
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
}));

vi.mock("../routing-mode.js", () => ({
  setGovernorSid: mocks.setGovernorSid,
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: vi.fn() };
});

vi.mock("../session-queue.js", () => ({
  createSessionQueue: vi.fn(),
  removeSessionQueue: vi.fn(),
  deliverServiceMessage: mocks.deliverServiceMessage,
  deliverReminderEvent: (...args: unknown[]) => mocks.deliverReminderEvent(...args),
  trackMessageOwner: mocks.trackMessageOwner,
  drainQueue: mocks.drainQueue,
  getSessionQueue: (...args: unknown[]) => mocks.getSessionQueue(...args),
}));

vi.mock("../poller.js", () => ({
  startPoller: (...args: unknown[]) => mocks.startPoller(...args),
  isPollerRunning: () => mocks.isPollerRunning(),
}));

vi.mock("../auto-approve.js", () => ({
  checkAndConsumeAutoApprove: () => mocks.checkAndConsumeAutoApprove(),
}));

vi.mock("../agent-approval.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    registerPendingApproval: (...args: unknown[]) => mocks.registerPendingApproval(...args),
    clearPendingApproval: (...args: unknown[]) => mocks.clearPendingApproval(...args),
  };
});

import { register, handleSessionReconnect } from "./session_start.js";
import {
  addReminder,
  resetReminderStateForTest,
} from "../reminder-state.js";
import { runInSessionContext } from "../session-context.js";
import { setDelegationEnabled } from "../agent-approval.js";

describe("session_start tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetReminderStateForTest();
    setDelegationEnabled(false);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.deliverReminderEvent.mockReturnValue(true);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);
    mocks.isPollerRunning.mockReturnValue(false);
    mocks.createSession.mockReturnValue({
      sid: 1,
      pin: 123456,
      name: "Primary",
      color: "🟦",
      sessionsActive: 1,
    });
    const server = createMockServer();
    register(server);
    call = server.getHandler("session_start");
  });

  it("auto-drains pending messages and returns discarded count", async () => {
    mocks.pendingCount.mockReturnValue(3);
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce({ id: 3 })
      .mockReturnValueOnce(undefined);

    const result = parseResult(await call({}));

    expect(result).toEqual({
      token: 1123456,
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "fresh",
      pending: 0,
      discarded: 3,
      fellow_sessions: [],
      hint: "Save this token. Read: help(topic: 'startup')",
    });
  });

  it("creates session and returns fresh when no pending", async () => {
    mocks.pendingCount.mockReturnValue(0);

    const result = parseResult(await call({}));

    expect(result).toEqual({
      token: 1123456,
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "fresh",
      pending: 0,
      discarded: 0,
      fellow_sessions: [],
      hint: "Save this token. Read: help(topic: 'startup')",
    });
  });

  it("returns discarded: 0 when nothing was pending", async () => {
    mocks.pendingCount.mockReturnValue(0);

    const result = parseResult(await call({}));

    expect(result.discarded).toBe(0);
  });

  it("calls createSession with provided name", async () => {
    mocks.pendingCount.mockReturnValue(0);

    await call({ name: "Worker Bee" });

    expect(mocks.createSession).toHaveBeenCalledWith("Worker Bee", undefined, false);
  });

  it("passes 'Primary' when name is omitted for first session", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 123456, name: "Primary", sessionsActive: 1 });

    await call({});

    expect(mocks.createSession).toHaveBeenCalledWith("Primary", undefined, false);
  });

  it("returns session credentials from createSession", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({
      sid: 3,
      pin: 719304,
      name: "scout",
      sessionsActive: 3,
    });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    const result = parseResult(await call({ name: "scout" }));

    expect(result.sid).toBe(3);
    expect(result.pin).toBe(719304);
    expect(result.sessions_active).toBe(3);
  });

  it("calls setActiveSession with the new session SID", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({
      sid: 5,
      pin: 999999,
      name: "Active Test",
      sessionsActive: 2,
    });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Active Test" });

    expect(mocks.setActiveSession).toHaveBeenCalledWith(5);
  });

  // =========================================================================
  // Multi-session: fellow_sessions / routing_mode
  // =========================================================================

  it("includes fellow_sessions in fast-path result when sessionsActive > 1", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 4, pin: 444444, name: "scout", sessionsActive: 2 });
    // Collision check (pre-creation)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 3, name: "leader" },
    ]);
    // fellow_sessions (post-creation)
    mocks.listSessions.mockReturnValue([
      { sid: 3, name: "leader" },
      { sid: 4, name: "scout" },
    ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt;

    const result = parseResult(await call({ name: "scout" }));

    expect(result.action).toBe("fresh");
    expect(Array.isArray(result.fellow_sessions)).toBe(true);
    // Only the OTHER session is in fellow_sessions (not self)
    const fellows = result.fellow_sessions as Array<{ sid: number }>;
    expect(fellows.every(s => s.sid !== 4)).toBe(true);
    expect(fellows.some(s => s.sid === 3)).toBe(true);
  });

  it("includes fellow_sessions when auto-draining with multiple sessions", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 6, pin: 666666, name: "gamma", sessionsActive: 2 });
    // Collision check (pre-creation)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 5, name: "delta" },
    ]);
    // fellow_sessions (post-creation)
    mocks.listSessions.mockReturnValue([
      { sid: 5, name: "delta" },
      { sid: 6, name: "gamma" },
    ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt;
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce(undefined);

    const result = parseResult(await call({ name: "gamma" }));

    expect(result.action).toBe("fresh");
    expect(result.discarded).toBe(2);
    const fellows = result.fellow_sessions as Array<{ sid: number }>;
    expect(fellows.some(s => s.sid === 5)).toBe(true);
    expect(fellows.every(s => s.sid !== 6)).toBe(true);
  });

  it("returns fellow_sessions: [] when only one session is active", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "solo", sessionsActive: 1 });

    const result = parseResult(await call({ name: "solo" }));

    expect(result.fellow_sessions).toEqual([]);
  });

  it("rolls back session on unexpected error during session setup", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 5, pin: 500005, name: "Worker", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary" }])
      .mockReturnValue([{ sid: 1, name: "Primary" }, { sid: 5, name: "Worker" }]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.deliverServiceMessage.mockImplementationOnce(() => { throw new Error("service error"); });
    const result = await call({ name: "Worker" });
    expect(isError(result)).toBe(true);
    expect(mocks.closeSession).toHaveBeenCalledWith(5);
    expect(mocks.setActiveSession).toHaveBeenCalledWith(0);
  });

  it("returns error when chat is not configured", async () => {
    mocks.resolveChat.mockReturnValueOnce({ code: "UNAUTHORIZED_CHAT", message: "no chat" } as never);
    const result = await call({});
    expect(isError(result)).toBe(true);
  });

  // =========================================================================
  // Name collision guard
  // =========================================================================

  it("rejects session_start when a session with the same name already exists", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);

    const result = await call({ name: "Overseer" });

    expect(isError(result)).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("NAME_CONFLICT");
    expect(text).toContain("Overseer");
    // Must NOT create a session
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects name collision case-insensitively", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "overseer", createdAt: "2026-03-17" }]);

    const result = await call({ name: "OVERSEER" });

    expect(isError(result)).toBe(true);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("allows session_start when name differs from existing sessions", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Scout", sessionsActive: 2 });

    const result = parseResult(await call({ name: "Scout" }));

    expect(result.sid).toBe(2);
    expect(mocks.createSession).toHaveBeenCalledWith("Scout", undefined, false);
  });

  it("first session gets 'Primary' default even when other sessions exist", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Primary", sessionsActive: 1 });

    const result = parseResult(await call({}));

    expect(result.sid).toBe(2);
    expect(mocks.createSession).toHaveBeenCalledWith("Primary", undefined, false);
  });

  // =========================================================================
  // Auto-governor activation
  // =========================================================================

  it("auto-activates governor mode when second session joins", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    // Collision check (pre-creation — "Worker" not yet in the list)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
    ]);
    // allSessions (post-creation)
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Worker" });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(1);
  });

  it("sets governor SID when first session starts", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "", sessionsActive: 1 });

    await call({});

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(1);
  });

  it("selects lowest SID as governor when gap exists", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 5, pin: 500005, name: "Late", sessionsActive: 2 });
    // Collision check ("Late" not yet in list)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 3, name: "Early", createdAt: "2026-03-17" },
    ]);
    // allSessions (First session has SID 3, not 1)
    mocks.listSessions.mockReturnValue([
      { sid: 3, name: "Early", createdAt: "2026-03-17" },
      { sid: 5, name: "Late", createdAt: "2026-03-17" },
    ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Late" });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(3);
  });

  it("does not auto-activate governor when third or later session joins", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 3, pin: 300003, name: "Third", sessionsActive: 3 });
    // Collision check
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
      { sid: 2, name: "Second", createdAt: "2026-03-17" },
    ]);
    // allSessions
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
      { sid: 2, name: "Second", createdAt: "2026-03-17" },
      { sid: 3, name: "Third", createdAt: "2026-03-17" },
    ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Third" });

    expect(mocks.setGovernorSid).not.toHaveBeenCalled();
  });

  it("fresh second session uses lowest-SID as governor", async () => {
    // session/start always creates fresh sessions; reconnect logic moved to session/reconnect
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 3, pin: 300003, name: "Overseer", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 2, name: "Worker", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
        { sid: 3, name: "Overseer", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Overseer" });

    // Fresh second session uses lowest-SID heuristic (SID 2)
    expect(mocks.setGovernorSid).toHaveBeenCalledWith(2);
  });

  // =========================================================================
  // Approval gate
  // =========================================================================

  it("first session is auto-approved without operator interaction", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    const result = parseResult(await call({ name: "Primary" }));

    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(result.sid).toBe(1);
    expect(mocks.createSession).toHaveBeenCalledWith("Primary", undefined, false);
  });

  it("first session defaults name to 'Primary' when none provided", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    await call({});

    expect(mocks.createSession).toHaveBeenCalledWith("Primary", undefined, false);
  });

  it("second session requires operator approval and succeeds on approve", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Scout", sessionsActive: 2 });
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 200 })  // approval prompt;
    // Simulate operator pressing Approve
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "cqid" } }); });
    });

    const result = parseResult(await call({ name: "Scout" }));

    expect(mocks.registerCallbackHook).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith("Scout", "🟦", true);
    expect(result.sid).toBe(2);
  });

  it("second session denied by operator → returns error, session not created", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValue({ message_id: 201 });
    // Simulate operator pressing Deny
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_no", qid: "cqid" } }); });
    });

    const result = await call({ name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_DENIED");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("second session timed out → returns SESSION_DENIED, session not created", async () => {
    vi.useFakeTimers();
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValue({ message_id: 202 });
    // Don't call the hook — let the timeout fire
    mocks.registerCallbackHook.mockImplementationOnce(() => { /* never calls fn */ });

    const callPromise = call({ name: "Scout" });
    // Advance clock past the 60s approval timeout
    await vi.runAllTimersAsync();
    const result = await callPromise;
    vi.useRealTimers();

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_DENIED");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Gap 3: Approval timeout cleanup — pending registry and callback hook cleared
  // =========================================================================

  it("approval timeout: clears callback hook and pending approval on timeout", async () => {
    vi.useFakeTimers();
    try {
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
      mocks.sendMessage.mockResolvedValue({ message_id: 203 });
      // Capture the registered message ID so we can verify clearCallbackHook is called with it
      let capturedMsgId: number | undefined;
      mocks.registerCallbackHook.mockImplementationOnce((msgId: number) => {
        capturedMsgId = msgId;
        // never invoke the callback — let the timeout fire
      });

      const callPromise = call({ name: "Scout" });
      // Advance clock past the 120s approval timeout (APPROVAL_TIMEOUT_MS)
      await vi.runAllTimersAsync();
      const result = await callPromise;

      // Session must be denied
      expect(isError(result)).toBe(true);
      expect(JSON.stringify(result)).toContain("SESSION_DENIED");
      // capturedMsgId must have been set — if not, registerCallbackHook was never called
      expect(capturedMsgId).toBeDefined();
      // The callback hook registered for the approval dialog must be cleared (cleanup)
      expect(mocks.clearCallbackHook).toHaveBeenCalledWith(capturedMsgId);
      // The pending approval registry must be cleared on timeout
      expect(mocks.clearPendingApproval).toHaveBeenCalled();
      // No session was created — approval never succeeded
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("second session without a name → immediate error, no approval prompt", async () => {
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);

    const result = await call({});

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_REQUIRED");
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Alphanumeric name validation (task 250)
  // =========================================================================

  it("rejects name with symbols → INVALID_NAME", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    const result = await call({ name: "Scout!" });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects name with underscore → INVALID_NAME", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    const result = await call({ name: "Scout_2" });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects name with emoji → INVALID_NAME", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    const result = await call({ name: "Scout🤖" });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects name with non-Latin unicode → INVALID_NAME", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    const result = await call({ name: "スカウト" });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("accepts alphanumeric name with spaces", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "Scout Alpha", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = await call({ name: "Scout Alpha" });

    expect(isError(result)).toBe(false);
    expect(mocks.createSession).toHaveBeenCalledWith("Scout Alpha", undefined, false);
  });

  it("trims whitespace before validation — leading/trailing spaces are allowed", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "Scout", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = await call({ name: "  Scout  " });

    expect(isError(result)).toBe(false);
    expect(mocks.createSession).toHaveBeenCalledWith("Scout", undefined, false);
  });

  it("whitespace-only name on first session → uses 'Primary' default", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "Primary", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = await call({ name: "   " });

    expect(isError(result)).toBe(false);
    expect(mocks.createSession).toHaveBeenCalledWith("Primary", undefined, false);
  });

  it("alphanumeric name with digits is accepted", async () => {
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "Scout2", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = await call({ name: "Scout2" });

    expect(isError(result)).toBe(false);
    expect(mocks.createSession).toHaveBeenCalledWith("Scout2", undefined, false);
  });

  // =========================================================================
  // Service messages on session join (task 285)
  // =========================================================================

  it("injects session_joined service message to existing session when 2nd session joins", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]) // collision
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Worker" });

    // Existing session (the governor) notified of the join
    const calls = mocks.deliverServiceMessage.mock.calls;
    const toExisting = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_joined");
    expect(toExisting).toBeDefined();
    expect(toExisting![2]).toBe("session_joined");
    expect(String(toExisting![1])).toContain("Worker");
    expect(String(toExisting![1])).toContain("governor");
  });

  it("injects session_orientation service message to new session on join", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Worker" });

    // New session (SID 2) gets an orientation message
    const calls = mocks.deliverServiceMessage.mock.calls;
    const toNew = calls.find((c: unknown[]) => c[0] === 2);
    expect(toNew).toBeDefined();
    expect(toNew![2]).toBe("session_orientation");
    expect(String(toNew![1])).toContain("SID 2");
  });

  it("first session receives session_orientation service message", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    await call({});

    const calls = mocks.deliverServiceMessage.mock.calls;
    const orientation = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_orientation");
    expect(orientation).toBeDefined();
    expect(String(orientation![1])).toContain("SID 1");
  });

  // =========================================================================
  // First session announcement (task 018)
  // =========================================================================

  it("first session sends online announcement to chat", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });

    await call({});

    const announceCalls = mocks.sendMessage.mock.calls.filter(
      (c: unknown[]) => String(c[1]).includes("🟢 Online"),
    );
    expect(announceCalls.length).toBeGreaterThanOrEqual(1);
    const announceText = String(announceCalls[0][1]);
    const announceOpts = announceCalls[0][2] as Record<string, unknown>;
    expect(announceText).toContain("`Primary`");
    expect(announceText).toContain("🟦");
    // Announcement must use MarkdownV2 (defense against injection via session names)
    expect(announceOpts.parse_mode).toBe("MarkdownV2");
  });

  it("first session announcement is tracked with trackMessageOwner", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 55 });

    await call({});

    expect(mocks.trackMessageOwner).toHaveBeenCalledWith(55, 1);
  });

  it("first session session_orientation includes announcement_message_id", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 77 });

    await call({});

    const calls = mocks.deliverServiceMessage.mock.calls;
    const orientation = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_orientation");
    expect(orientation).toBeDefined();
    expect((orientation![3] as Record<string, unknown>).announcement_message_id).toBe(77);
  });

  // =========================================================================
  // reconnect: true — server restart recovery (task 350)
  // =========================================================================

  it("session/start always returns action='fresh'", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = parseResult(await call({}));

    expect(result.action).toBe("fresh");
  });

  it("session/start approval prompt says 'New session requesting access'", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Worker", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Worker" });

    // First sendMessage is the approval prompt
    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(promptOpts.parse_mode).toBe("MarkdownV2");
    const promptText = (mocks.sendMessage.mock.calls[0] as unknown[])[1] as string;
    expect(promptText).toContain("New session requesting access");
    expect(promptText).not.toContain("reconnecting");
  });

  it("session/start service message to fellow says 'has joined'", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Worker", sessionsActive: 2 });
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    await call({ name: "Worker" });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const toExisting = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_joined");
    expect(toExisting).toBeDefined();
    expect(String(toExisting![1])).toContain("has joined");
    expect(String(toExisting![1])).not.toContain("has reconnected");
    // session/start does not set reconnect flag in details
    const details = toExisting![3] as Record<string, unknown>;
    expect(details.reconnect).toBeUndefined();
  });

  it("session/start second session result action is always 'fresh'", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Worker", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });

    const result = parseResult(await call({ name: "Worker" }));

    expect(result.action).toBe("fresh");
  });

  it("reconnect: false (default) keeps fresh/joined behavior unchanged", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.listSessions.mockReturnValue([]);

    const result = parseResult(await call({}));

    expect(result.action).toBe("fresh");
  });

  // =========================================================================
  // Color-picker approval dialog (task 080)
  // =========================================================================

  it("approval prompt shows color buttons from getAvailableColors", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    // First sendMessage is the approval prompt with color buttons
    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const buttons = keyboard[0] as Array<Record<string, unknown>>;
    const colorButtonData = buttons.filter(b => String(b.callback_data).startsWith("approve_") && b.callback_data !== "approve_no").map(b => b.callback_data);
    expect(colorButtonData).toContain("approve_0");
    expect(colorButtonData).toContain("approve_1");
    expect(colorButtonData).toContain("approve_2");
  });

  it("approval prompt has Deny button", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    // 2 rows of color buttons + 1 deny row = keyboard[2]
    const denyRow = keyboard[2] as Array<Record<string, unknown>>;
    const denyButton = denyRow.find(b => b.callback_data === "approve_no");
    expect(denyButton).toBeDefined();
  });

  it("tapping a color approves and passes operator-chosen color to createSession", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]).mockReturnValue([]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker" });

    // createSession should receive the operator-chosen color 🟩
    expect(mocks.createSession).toHaveBeenCalledWith("Worker", "🟩", true);
  });

  it("approval prompt deleted (not edited) after operator approves", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]).mockReturnValue([]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker" });

    // Approval prompt is DELETED, not edited to show "approved"
    expect(mocks.deleteMessage).toHaveBeenCalledWith(42, 50);
    expect(mocks.editMessageText).not.toHaveBeenCalledWith(
      42,
      50,
      expect.stringContaining("approved"),
      expect.any(Object),
    );
  });

  it("broadcasts online announcement after approval and tracks message ownership", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValueOnce({ message_id: 51 });  // broadcast announcement
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker" });

    // A second sendMessage with the online announcement was sent
    const announceCalls = mocks.sendMessage.mock.calls.filter(
      (c: unknown[]) => String(c[1]).includes("🟢 Online"),
    );
    expect(announceCalls.length).toBeGreaterThanOrEqual(1);
    const announceText = String(announceCalls[0][1]);
    expect(announceText).toContain("Session 2");

    // Announcement tracked to SID 2 so replies route to it
    expect(mocks.trackMessageOwner).toHaveBeenCalledWith(51, 2);
  });

  it("includes announcement_message_id in session_joined service message details", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValueOnce({ message_id: 99 });  // broadcast

    await call({ name: "Worker" });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const toExisting = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_joined");
    expect(toExisting).toBeDefined();
    expect((toExisting![3] as Record<string, unknown>).announcement_message_id).toBe(99);

    const toNew = calls.find((c: unknown[]) => c[0] === 2 && c[2] === "session_orientation");
    expect(toNew).toBeDefined();
    expect((toNew![3] as Record<string, unknown>).announcement_message_id).toBe(99);
  });

  it("post-decision edit shows name (no color) after denial", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_no", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValue({ message_id: 50 });

    const result = await call({ name: "Worker" });

    expect(isError(result)).toBe(true);
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      50,
      expect.stringContaining("Worker"),
      expect.any(Object),
    );
    // Should NOT contain a color emoji in the denial edit
    const editCall = mocks.editMessageText.mock.calls[0] as unknown[];
    expect(String(editCall[2])).not.toMatch(/🟦|🟩|🟨|🟧|🟥|🟪/);
  });

  it("agent's color hint passed to getAvailableColors", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]).mockReturnValue([]);
    mocks.getAvailableColors.mockReturnValue(["🟩", "🟦"]); // 🟩 first = hint honored
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker", color: "🟩" });

    expect(mocks.getAvailableColors).toHaveBeenCalledWith("🟩");
  });

  it("first fresh color is the first button when no hint provided", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    // 🟦 is used; fresh colors start with 🟩
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([{ sid: 1, name: "Primary", color: "🟦", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟩", "🟨", "🟧", "🟥", "🟪", "🟦"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row1 = keyboard[0] as Array<Record<string, unknown>>;
    const firstButton = row1[0];
    expect(firstButton.text).toBe("🟩");
    // Buttons should be split across 2 rows
    expect(keyboard[0]).toHaveLength(3);
    expect(keyboard[1]).toHaveLength(3);
  });

  it("hint is the first button when hint is a fresh color", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    // 🟦 is used; hint 🟥 is fresh
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([{ sid: 1, name: "Primary", color: "🟦", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟥", "🟩", "🟨", "🟧", "🟪", "🟦"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_4", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟥", sessionsActive: 2 });

    await call({ name: "Worker", color: "🟥" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row1 = keyboard[0] as Array<Record<string, unknown>>;
    // Hint color must be the very first button
    expect(row1[0].text).toBe("🟥");
  });

  it("hint is still the first button even when hint color is already used", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    // 🟦 and 🟥 are used; hint is 🟥 (used); first fresh is 🟩
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", color: "🟦", createdAt: "2026-03-17" },
        { sid: 2, name: "Other", color: "🟥", createdAt: "2026-03-17" },
      ]);
    mocks.getAvailableColors.mockReturnValue(["🟥", "🟩", "🟨", "🟧", "🟪", "🟦"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 3, pin: 300003, name: "Worker2", color: "🟩", sessionsActive: 3 });

    await call({ name: "Worker2", color: "🟥" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row1 = keyboard[0] as Array<Record<string, unknown>>;
    // Even when hint (🟥) is already used, it gets position 0 — agent's
    // requested color is always the most prominent button.
    expect(row1[0].text).toBe("🟥");
  });

  it("invalid colorHint (not in palette) is ignored — first fresh color is first button", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([{ sid: 1, name: "Primary", color: "🟦", createdAt: "2026-03-17" }]);
    // getAvailableColors correctly ignores invalid hint; 🟩 is first fresh
    mocks.getAvailableColors.mockReturnValue(["🟩", "🟨", "🟧", "🟥", "🟪", "🟦"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker", color: "❌" }); // invalid hint — not in COLOR_PALETTE

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const allButtons = [
      ...(keyboard[0] as Array<Record<string, unknown>>),
      ...(keyboard[1] as Array<Record<string, unknown>>),
    ];
    // Invalid hint must not appear as a button
    const invalidButton = allButtons.find(b => b.text === "❌");
    expect(invalidButton).toBeUndefined();
    // First fresh palette color should be the first button
    const row1 = keyboard[0] as Array<Record<string, unknown>>;
    expect(row1[0].text).toBe("🟩");
  });

  it("color-picker approval still works for fresh second session", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker" });

    expect(mocks.createSession).toHaveBeenCalledWith("Worker", "🟩", true);
  });

  // =========================================================================
  // Pin announcement message (task 022)
  // =========================================================================

  it("pins the announcement message after it is sent for multi-session join", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValueOnce({ message_id: 77 });  // announcement
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    expect(mocks.pinChatMessage).toHaveBeenCalledWith(42, 77, { disable_notification: true });
  });

  it("stores the announcement message ID via setSessionAnnouncementMessage", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValueOnce({ message_id: 88 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    expect(mocks.setSessionAnnouncementMessage).toHaveBeenCalledWith(2, 88);
  });

  it("does not pin if announcement send fails", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockRejectedValueOnce(new Error("send failed")); // announcement fails
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    expect(mocks.pinChatMessage).not.toHaveBeenCalled();
    expect(mocks.setSessionAnnouncementMessage).not.toHaveBeenCalled();
  });

  it("does not pin when first session announcement fails to send", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce(undefined);

    await call({});

    expect(mocks.pinChatMessage).not.toHaveBeenCalled();
  });

  it("first session announcement is NOT pinned (deferred until second session joins)", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 55 });

    await call({});

    expect(mocks.pinChatMessage).not.toHaveBeenCalled();
  });

  it("second session retroactively pins first session announcement when sessionsActive === 2", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Worker", color: "🟩", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-20" }])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-20" },
        { sid: 2, name: "Worker", createdAt: "2026-03-20" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValueOnce({ message_id: 99 });  // new session announcement
    // SID 1 had its announcement stored (msg 77)
    mocks.getSessionAnnouncementMessage.mockReturnValue(77);

    await call({ name: "Worker" });

    // First session's announcement (77) retroactively pinned
    expect(mocks.pinChatMessage).toHaveBeenCalledWith(42, 77, { disable_notification: true });
    // New session's announcement (99) also pinned
    expect(mocks.pinChatMessage).toHaveBeenCalledWith(42, 99, { disable_notification: true });
  });

  it("third+ session does not trigger retroactive pinning", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 3, pin: 333333, name: "Third", sessionsActive: 3 });
    mocks.listSessions
      .mockReturnValueOnce([
        { sid: 1, name: "Primary", createdAt: "2026-03-20" },
        { sid: 2, name: "Worker", createdAt: "2026-03-20" },
      ])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-20" },
        { sid: 2, name: "Worker", createdAt: "2026-03-20" },
        { sid: 3, name: "Third", createdAt: "2026-03-20" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValueOnce({ message_id: 101 }); // new session announcement
    mocks.getSessionAnnouncementMessage.mockReturnValue(77);

    await call({ name: "Third" });

    // getSessionAnnouncementMessage should NOT have been called for retroactive pinning
    // (only the new session's announcement is pinned)
    expect(mocks.pinChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.pinChatMessage).toHaveBeenCalledWith(42, 101, { disable_notification: true });
  });

  it("first session announcement tracked via setSessionAnnouncementMessage", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 88 });

    await call({});

    expect(mocks.setSessionAnnouncementMessage).toHaveBeenCalledWith(1, 88);
  });

  // =========================================================================
  // Reconnect flow — operator re-authorization (task 051)
  // =========================================================================

  it("NAME_CONFLICT error message tells agent to find token in session memory", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);

    const result = await call({ name: "Overseer" });

    expect(isError(result)).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("NAME_CONFLICT");
    expect(text).toContain("already online");
    expect(text).toContain("dequeue");
    expect(text).not.toContain("reconnect: true");
    expect(text).toContain("session/reconnect");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("reconnect: true + name match → shows simple Approve/Deny dialog, not color picker", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 12345, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 400 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq1" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(mocks.registerCallbackHook).toHaveBeenCalled();
    // Approval callback data must be reconnect_yes, not approve_N (color picker)
    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>)
      .inline_keyboard as unknown[][];
    const approveRow = keyboard[0] as Array<Record<string, unknown>>;
    expect(approveRow.some(b => b.callback_data === "reconnect_yes")).toBe(true);
    expect(approveRow.some(b => String(b.callback_data).startsWith("approve_"))).toBe(false);
    // No new session created
    expect(mocks.createSession).not.toHaveBeenCalled();
    // Returns the existing SID and token
    expect(result.sid).toBe(1);
    expect(result.token).toBe(1123456);
    expect(result.action).toBe("reconnected");
  });

  it("reconnect: true + approved → preserves queued messages and resets health state", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    const fakeSession = {
      sid: 1, pin: 999999, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 99999, healthy: false,
    };
    mocks.getSession.mockReturnValue(fakeSession);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 401 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq2" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(result.token).toBe(1999999);
    expect(mocks.drainQueue).not.toHaveBeenCalled();
    expect(mocks.setActiveSession).toHaveBeenCalledWith(1);
    // Health state reset (mutations on the fakeSession object)
    expect(fakeSession.lastPollAt).toBeUndefined();
    expect(fakeSession.healthy).toBe(true);
  });

  it("reconnect: true + approved → returns actual pending count from session queue", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 999999, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 99999, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 401 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq2" } }); });
    });
    mocks.getSessionQueue.mockReturnValue({ pendingCount: () => 5 });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(result.pending).toBe(5);
  });

  it("reconnect: true + approved → returns pending 0 when queue is missing", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 999999, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 99999, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 401 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq2" } }); });
    });
    mocks.getSessionQueue.mockReturnValue(undefined);

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(result.pending).toBe(0);
  });

  it("reconnect: true + operator denies → SESSION_DENIED, no session created", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValue({ message_id: 402 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_no", qid: "rq3" } }); });
    });

    const result = await handleSessionReconnect({ name: "Overseer" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_DENIED");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.drainQueue).not.toHaveBeenCalled();
  });

  it("reconnect: true + timeout → SESSION_DENIED", async () => {
    vi.useFakeTimers();
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValue({ message_id: 403 });
    mocks.registerCallbackHook.mockImplementationOnce(() => { /* never fires */ });

    const callPromise = handleSessionReconnect({ name: "Overseer" });
    await vi.runAllTimersAsync();
    const result = await callPromise;
    vi.useRealTimers();

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_DENIED");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("reconnect: true + single session approved → sends session_orientation with reconnect text", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 111111, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 404 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq5" } }); });
    });

    await handleSessionReconnect({ name: "Overseer" });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const orientation = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_orientation");
    expect(orientation).toBeDefined();
    expect(String(orientation![1])).toContain("Reconnect authorized");
    expect(String(orientation![1])).toContain("SID 1");
  });

  it("reconnect: true + multi-session approved → sends session_joined to fellows", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Overseer", createdAt: "2026-03-17" },
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 111111, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.getGovernorSid.mockReturnValue(2);
    mocks.activeSessionCount.mockReturnValue(2);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 405 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq6" } }); });
    });

    await handleSessionReconnect({ name: "Overseer" });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const toFellow = calls.find((c: unknown[]) => c[0] === 2 && c[2] === "session_joined");
    expect(toFellow).toBeDefined();
    expect(String(toFellow![1])).toContain("reconnected");
    expect((toFellow![3] as Record<string, unknown>).reconnect).toBe(true);

    const toSelf = calls.find((c: unknown[]) => c[0] === 1 && c[2] === "session_orientation");
    expect(toSelf).toBeDefined();
    expect(String(toSelf![1])).toContain("Reconnect authorized");
  });

  it("reconnect: true + denial edits dialog to show denied (not deleted)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValue({ message_id: 406 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_no", qid: "rq7" } }); });
    });

    await handleSessionReconnect({ name: "Overseer" });

    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      406,
      expect.stringContaining("Overseer"),
      expect.any(Object),
    );
    expect(mocks.deleteMessage).not.toHaveBeenCalledWith(42, 406);
  });

  it("handleSessionReconnect: name no-match → SESSION_NOT_FOUND error", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);

    const result = await handleSessionReconnect({ name: "Overseer" });

    // No session named "Overseer" → SESSION_NOT_FOUND error
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_NOT_FOUND");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Lazy poller lifecycle (task 055)
  // =========================================================================

  it("starts poller when first session is created and poller is idle", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.isPollerRunning.mockReturnValue(false);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    await call({});

    expect(mocks.startPoller).toHaveBeenCalledOnce();
  });

  it("does not start poller when it is already running", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.isPollerRunning.mockReturnValue(true);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    await call({});

    expect(mocks.startPoller).not.toHaveBeenCalled();
  });

  // =========================================================================
  // hint field — persistence & recovery hints (task 056)
  // =========================================================================

  it("fresh session response includes hint field", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    const result = parseResult(await call({}));

    expect(typeof result.hint).toBe("string");
    expect(result.hint).toBeTruthy();
  });

  it("fresh session returns hint pointing to startup topic", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

    const result = parseResult(await call({}));

    expect(result.hint).toContain("startup");
    expect(result.profile_hint).toBeUndefined();
    expect(result.instructions).toBeUndefined();
  });

  // =========================================================================
  // Startup reminder integration (task 260)
  // =========================================================================

  describe("startup reminders fired on session_start", () => {
    beforeEach(() => {
      resetReminderStateForTest();
    });

    it("startup reminders are delivered to the session queue after a fresh session_start", async () => {
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", color: "🟦", sessionsActive: 1 });

      // Pre-load a startup reminder for SID 1
      runInSessionContext(1, () => {
        addReminder({ id: "s-fresh", text: "Boot check", delay_seconds: 0, recurring: false, trigger: "startup" });
      });

      await call({});

      // deliverReminderEvent must have been called for the startup reminder
      expect(mocks.deliverReminderEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ event: "reminder" }),
      );
    });

    it("startup reminders fire after session_start with reconnect: true", async () => {
      mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
      mocks.getSession.mockReturnValue({
        sid: 1, pin: 111111, name: "Overseer", color: "🟦",
        createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
      });
      mocks.activeSessionCount.mockReturnValue(1);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 601 });
      mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
        void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-sr" } }); });
      });

      // Pre-load a startup reminder for SID 1 (the reconnecting session)
      runInSessionContext(1, () => {
        addReminder({ id: "s-recon", text: "Reconnect check", delay_seconds: 0, recurring: false, trigger: "startup" });
      });

      await handleSessionReconnect({ name: "Overseer" });

      expect(mocks.deliverReminderEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ event: "reminder" }),
      );
    });

    it("one-shot startup reminder is not present after firing (not re-delivered on second session_start)", async () => {
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Alpha", color: "🟩", sessionsActive: 1 });

      runInSessionContext(2, () => {
        addReminder({ id: "s-oneshot", text: "One shot", delay_seconds: 0, recurring: false, trigger: "startup" });
      });

      // First session_start: fires the one-shot
      await call({ name: "Alpha" });

      const callCountAfterFirst = mocks.deliverReminderEvent.mock.calls.length;
      expect(callCountAfterFirst).toBeGreaterThanOrEqual(1);

      // Reset mocks and run second session_start — one-shot should NOT fire again
      vi.clearAllMocks();
      mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Alpha", color: "🟩", sessionsActive: 1 });
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.getSessionQueue.mockReturnValue({ pendingCount: () => 0 });
      mocks.listSessions.mockReturnValue([]);
      mocks.isPollerRunning.mockReturnValue(false);
      mocks.deliverReminderEvent.mockReturnValue(true);

      await call({ name: "Alpha" });

      expect(mocks.deliverReminderEvent).not.toHaveBeenCalled();
    });

    it("recurring startup reminder fires again on a second session_start", async () => {
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.createSession.mockReturnValue({ sid: 3, pin: 333333, name: "Beta", color: "🟨", sessionsActive: 1 });

      runInSessionContext(3, () => {
        addReminder({ id: "s-recurring", text: "Every start", delay_seconds: 0, recurring: true, trigger: "startup" });
      });

      // First session_start
      await call({ name: "Beta" });

      expect(mocks.deliverReminderEvent).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ event: "reminder" }),
      );

      // Reset mocks for second call
      vi.clearAllMocks();
      mocks.createSession.mockReturnValue({ sid: 3, pin: 333333, name: "Beta", color: "🟨", sessionsActive: 1 });
      mocks.pendingCount.mockReturnValue(0);
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.getSessionQueue.mockReturnValue({ pendingCount: () => 0 });
      mocks.listSessions.mockReturnValue([]);
      mocks.isPollerRunning.mockReturnValue(false);
      mocks.deliverReminderEvent.mockReturnValue(true);

      // Second session_start — recurring reminder must fire again
      await call({ name: "Beta" });

      expect(mocks.deliverReminderEvent).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ event: "reminder" }),
      );
    });
  });

  it("reconnect response (name match + approved) includes hint field", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 12345, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 500 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq10" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(typeof result.hint).toBe("string");
    expect(result.hint).toBeTruthy();
    expect(result.hint).toContain("SAVE THIS TOKEN");
  });

  it("reconnect returns hint pointing to startup topic", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 12345, healthy: false,
    });
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 501 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq11" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(result.hint).toContain("startup");
    expect(result.profile_hint).toBeUndefined();
    expect(result.instructions).toBeUndefined();
  });

  // =========================================================================
  // Auto-approve integration (task 271)
  // =========================================================================

  it("requestApproval: when checkAndConsumeAutoApprove returns true, skips approval dialog and returns approved", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Scout", sessionsActive: 2, color: "🟩" });
    mocks.checkAndConsumeAutoApprove.mockReturnValueOnce(true);

    const result = parseResult(await call({ name: "Scout" }));

    // registerCallbackHook should NOT have been called (no approval dialog was shown)
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(result.sid).toBe(2);
    // Auto-approve now uses availableColors[0] (not the raw hint) to avoid duplicate colors
    expect(mocks.createSession).toHaveBeenCalledWith("Scout", "🟦", true);
  });

  it("requestReconnectApproval: when checkAndConsumeAutoApprove returns true, skips approval dialog and returns reconnected", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 3, name: "Overseer", color: "🟦", createdAt: "2026-03-17" },
    ]);
    mocks.getSession.mockReturnValue({ sid: 3, pin: 301000, name: "Overseer", color: "🟦", healthy: true });
    mocks.getSessionQueue.mockReturnValue({ pendingCount: () => 0 });
    mocks.checkAndConsumeAutoApprove.mockReturnValueOnce(true);

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    // registerCallbackHook should NOT have been called (no approval dialog was shown)
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(result.action).toBe("reconnected");
  });

  // =========================================================================
  // Delegation toggle & color button styles (spec: approval dialog)
  // =========================================================================

  it("deny button has danger style", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row3 = keyboard[2] as Array<Record<string, unknown>>;
    const denyButton = row3.find(b => b.callback_data === "approve_no");
    expect(denyButton).toBeDefined();
    expect(denyButton!.style).toBe("danger");
  });

  it("delegation toggle button is in row 3, left of deny — OFF state by default", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row3 = keyboard[2] as Array<Record<string, unknown>>;
    expect(row3).toHaveLength(2);
    const toggleButton = row3[0];
    expect(toggleButton.callback_data).toBe("approve_toggle_delegation");
    expect(toggleButton.text).toBe("☐ Delegate");
    expect(toggleButton.style).toBeUndefined();
  });

  it("delegation toggle button shows ON state when delegation is enabled", async () => {
    setDelegationEnabled(true);
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row3 = keyboard[2] as Array<Record<string, unknown>>;
    const toggleButton = row3[0];
    expect(toggleButton.text).toBe("✅ Delegated");
  });

  it("hint color button gets primary style", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    // hint 🟩 is at position 0 (promoted by getAvailableColors)
    mocks.getAvailableColors.mockReturnValue(["🟩", "🟦", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_1", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟩", sessionsActive: 2 });

    await call({ name: "Worker", color: "🟩" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const allButtons = [
      ...(keyboard[0] as Array<Record<string, unknown>>),
      ...(keyboard[1] as Array<Record<string, unknown>>),
    ];
    const hintButton = allButtons.find(b => b.text === "🟩");
    expect(hintButton).toBeDefined();
    expect(hintButton!.style).toBe("primary");
    // Only the hint button gets primary
    const otherPrimary = allButtons.filter(b => b.text !== "🟩" && b.style === "primary");
    expect(otherPrimary).toHaveLength(0);
  });

  it("no hint + delegation ON → first color button gets primary", async () => {
    setDelegationEnabled(true);
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row1 = keyboard[0] as Array<Record<string, unknown>>;
    expect(row1[0].style).toBe("primary");
    // Others in row1 do not get primary
    expect(row1[1].style).toBeUndefined();
    expect(row1[2].style).toBeUndefined();
  });

  it("no hint + delegation OFF → no color button gets primary", async () => {
    // delegation is OFF by default (setDelegationEnabled(false) in beforeEach)
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_0", qid: "q1" } }); });
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    await call({ name: "Worker" });

    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const colorButtons = [
      ...(keyboard[0] as Array<Record<string, unknown>>),
      ...(keyboard[1] as Array<Record<string, unknown>>),
    ];
    const primaryButtons = colorButtons.filter(b => b.style === "primary");
    expect(primaryButtons).toHaveLength(0);
  });

  it("delegation toggle does NOT resolve the approval promise", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    let hookFn: ((evt: unknown) => void) | undefined;
    mocks.registerCallbackHook.mockImplementation((_id: number, fn: (evt: unknown) => void) => {
      hookFn = fn;
    });

    const callPromise = call({ name: "Worker" });

    // Wait for sendMessage to be called
    await new Promise(r => setTimeout(r, 0));

    // Fire a toggle callback
    hookFn!({ content: { data: "approve_toggle_delegation", qid: "t1" } });
    await new Promise(r => setTimeout(r, 0));

    // Promise should NOT have resolved yet — editMessageReplyMarkup called, not deleteMessage
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalled();
    expect(mocks.deleteMessage).not.toHaveBeenCalled();

    // Now approve — the hook should have been re-registered
    hookFn!({ content: { data: "approve_0", qid: "q1" } });
    const result = parseResult(await callPromise);

    expect(result.sid).toBe(2);
  });

  it("delegation toggle toggles state and re-renders keyboard", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    let hookFn: ((evt: unknown) => void) | undefined;
    mocks.registerCallbackHook.mockImplementation((_id: number, fn: (evt: unknown) => void) => {
      hookFn = fn;
    });

    const callPromise = call({ name: "Worker" });
    await new Promise(r => setTimeout(r, 0));

    // Toggle ON
    hookFn!({ content: { data: "approve_toggle_delegation", qid: "t1" } });
    await new Promise(r => setTimeout(r, 0));

    // editMessageReplyMarkup should have been called with the updated keyboard
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
      42,
      50,
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
    const editedKeyboard = (mocks.editMessageReplyMarkup.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const row3 = ((editedKeyboard.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][])[2] as Array<Record<string, unknown>>;
    // Toggle button should now show ON state
    expect(row3[0].text).toBe("✅ Delegated");

    // Approve to finish
    hookFn!({ content: { data: "approve_0", qid: "q1" } });
    await callPromise;
  });

  it("button count stays constant across toggle states", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 50 });
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", color: "🟦", sessionsActive: 2 });

    let hookFn: ((evt: unknown) => void) | undefined;
    mocks.registerCallbackHook.mockImplementation((_id: number, fn: (evt: unknown) => void) => {
      hookFn = fn;
    });

    const callPromise = call({ name: "Worker" });
    await new Promise(r => setTimeout(r, 0));

    const countButtons = (keyboard: unknown[][]) =>
      keyboard.reduce((acc, row) => acc + row.length, 0);

    // Count initial buttons
    const initialOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2];
    const initialKeyboard = (initialOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const initialCount = countButtons(initialKeyboard);

    // Toggle
    hookFn!({ content: { data: "approve_toggle_delegation", qid: "t1" } });
    await new Promise(r => setTimeout(r, 0));

    const editedOpts = (mocks.editMessageReplyMarkup.mock.calls[0] as unknown[])[2];
    const editedKeyboard = (editedOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const editedCount = countButtons(editedKeyboard);

    expect(editedCount).toBe(initialCount);

    hookFn!({ content: { data: "approve_0", qid: "q1" } });
    await callPromise;
  });
});

// =============================================================================
// Reauth dialog auto-dismiss (task 30-475)
// =============================================================================

describe("reauth dialog auto-dismiss", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetReminderStateForTest();
    setDelegationEnabled(false);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.deliverReminderEvent.mockReturnValue(true);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);
    mocks.isPollerRunning.mockReturnValue(false);
    mocks.createSession.mockReturnValue({
      sid: 1,
      pin: 123456,
      name: "Primary",
      color: "🟦",
      sessionsActive: 1,
    });
    const server = createMockServer();
    register(server);
    call = server.getHandler("session_start");
  });

  it("stores reauthDialogMsgId on the session when reconnect dialog is sent", async () => {
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 700 });

    // Don't resolve — just let it send the dialog
    let hookFn: ((evt: unknown) => void) | undefined;
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      hookFn = fn;
    });

    const callPromise = handleSessionReconnect({ name: "Overseer" });

    // Wait for sendMessage to be called
    await new Promise(r => setTimeout(r, 0));

    // setSessionReauthDialogMsgId must have been called with sid=1, msgId=700
    expect(mocks.setSessionReauthDialogMsgId).toHaveBeenCalledWith(1, 700);

    // Resolve the dialog so the promise completes
    hookFn!({ content: { data: "reconnect_yes", qid: "rq-700" } });
    await callPromise;
  });

  it("clears reauthDialogMsgId after operator approves the reconnect dialog", async () => {
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 701 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-701" } }); });
    });

    await handleSessionReconnect({ name: "Overseer" });

    // clearSessionReauthDialogMsgId must have been called with sid=1 after approval
    expect(mocks.clearSessionReauthDialogMsgId).toHaveBeenCalledWith(1);
  });
});

// =============================================================================
// handleSessionReconnect — dedicated tests (task 10-489)
// =============================================================================

describe("handleSessionReconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReminderStateForTest();
    setDelegationEnabled(false);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.deliverReminderEvent.mockReturnValue(true);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([]);
    mocks.isPollerRunning.mockReturnValue(false);
    mocks.checkAndConsumeAutoApprove.mockReturnValue(false);
  });

  it("returns SESSION_NOT_FOUND when no session matches name", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);

    const result = await handleSessionReconnect({ name: "Overseer" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_NOT_FOUND");
    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
  });

  it("returns NAME_REQUIRED when name is empty", async () => {
    const result = await handleSessionReconnect({ name: "" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_REQUIRED");
  });

  it("returns NAME_REQUIRED for whitespace-only name", async () => {
    const result = await handleSessionReconnect({ name: "   " });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_REQUIRED");
  });

  it("shows simple Approve/Deny dialog (reconnect_yes/reconnect_no), not color picker", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 123456, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 12345, healthy: false,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 800 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-800" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    // Keyboard must use reconnect_yes, not approve_N
    const promptOpts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const keyboard = (promptOpts.reply_markup as Record<string, unknown>).inline_keyboard as unknown[][];
    const row = keyboard[0] as Array<Record<string, unknown>>;
    expect(row.some(b => b.callback_data === "reconnect_yes")).toBe(true);
    expect(row.some(b => String(b.callback_data).startsWith("approve_"))).toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(result.sid).toBe(1);
    expect(result.action).toBe("reconnected");
  });

  it("approval flow: returns existing SID+token and action='reconnected'", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Worker", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 2, pin: 654321, name: "Worker", color: "🟩",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: true,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 801 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-801" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Worker" }));

    expect(result.sid).toBe(2);
    expect(result.token).toBe(2654321);
    expect(result.action).toBe("reconnected");
  });

  it("denial flow: returns SESSION_DENIED, no session created", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 802 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_no", qid: "rq-802" } }); });
    });

    const result = await handleSessionReconnect({ name: "Overseer" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_DENIED");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("hint includes 'SAVE THIS TOKEN' and 'startup' after approval", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 111111, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 803 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-803" } }); });
    });

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(result.hint).toContain("SAVE THIS TOKEN");
    expect(result.hint).toContain("startup");
    expect(result.hint).toContain("Reconnect successful");
  });

  it("operator dialog text is just the name — no explanation text", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({
      sid: 1, pin: 111111, name: "Overseer", color: "🟦",
      createdAt: "2026-03-17", lastPollAt: 100, healthy: false,
    });
    mocks.sendMessage.mockResolvedValueOnce({ message_id: 804 });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "reconnect_yes", qid: "rq-804" } }); });
    });

    await handleSessionReconnect({ name: "Overseer" });

    const promptText = (mocks.sendMessage.mock.calls[0] as unknown[])[1] as string;
    // Must contain the session name
    expect(promptText).toContain("Overseer");
    // Must NOT contain the old explanation text
    expect(promptText).not.toContain("saved token");
    expect(promptText).not.toContain("token recovery failed");
    expect(promptText).not.toContain("Authorize re-entry");
  });

  it("auto-approve skips dialog and returns reconnected", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 3, name: "Overseer", color: "🟦", createdAt: "2026-03-17" }]);
    mocks.getSession.mockReturnValue({ sid: 3, pin: 301000, name: "Overseer", color: "🟦", healthy: true });
    mocks.getSessionQueue.mockReturnValue({ pendingCount: () => 0 });
    mocks.checkAndConsumeAutoApprove.mockReturnValueOnce(true);

    const result = parseResult(await handleSessionReconnect({ name: "Overseer" }));

    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(result.action).toBe("reconnected");
  });
});
