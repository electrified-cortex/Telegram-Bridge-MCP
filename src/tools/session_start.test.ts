import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  pendingCount: vi.fn(),
  dequeue: vi.fn(),
  createSession: vi.fn(),
  closeSession: vi.fn(),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  activeSessionCount: vi.fn().mockReturnValue(0),
  getRoutingMode: vi.fn().mockReturnValue("load_balance"),
  setRoutingMode: vi.fn(),
  resolveChat: vi.fn(() => 42 as number),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  deliverDirectMessage: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      answerCallbackQuery: mocks.answerCallbackQuery,
    }),
    resolveChat: () => mocks.resolveChat(),
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: (...args: unknown[]) => mocks.pendingCount(...args),
  dequeue: (...args: unknown[]) => mocks.dequeue(...args),
  registerCallbackHook: (...args: unknown[]) => mocks.registerCallbackHook(...args),
  clearCallbackHook: (...args: unknown[]) => mocks.clearCallbackHook(...args),
}));

vi.mock("../session-manager.js", () => ({
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  closeSession: (...args: unknown[]) => mocks.closeSession(...args),
  setActiveSession: (...args: unknown[]) => mocks.setActiveSession(...args),
  listSessions: (...args: unknown[]) => mocks.listSessions(...args),
  activeSessionCount: () => mocks.activeSessionCount(),
}));

vi.mock("../routing-mode.js", () => ({
  getRoutingMode: () => mocks.getRoutingMode(),
  setRoutingMode: (...args: unknown[]) => mocks.setRoutingMode(...args),
}));

vi.mock("../session-queue.js", () => ({
  createSessionQueue: vi.fn(),
  removeSessionQueue: vi.fn(),
  deliverDirectMessage: (...args: unknown[]) => mocks.deliverDirectMessage(...args),
}));

import { register } from "./session_start.js";

const INTRO_MSG = { message_id: 100, chat: { id: 42 }, date: 0 };

describe("session_start tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(INTRO_MSG);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);
    mocks.getRoutingMode.mockReturnValue("load_balance");
    mocks.createSession.mockReturnValue({
      sid: 1,
      pin: 123456,
      name: "Primary",
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

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "fresh",
      pending: 0,
      discarded: 3,
      intro_message_id: 100,
    });
  });

  it("sends intro message and returns fresh when no pending", async () => {
    mocks.pendingCount.mockReturnValue(0);

    const result = parseResult(await call({}));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    // Check intro text was sent
    const sentCall = mocks.sendMessage.mock.calls[0] as unknown[];
    expect(sentCall[0]).toBe(42); // chatId
    expect(result).toEqual({
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "fresh",
      pending: 0,
      intro_message_id: 100,
    });
  });

  it("uses custom intro text", async () => {
    mocks.pendingCount.mockReturnValue(0);

    await call({ intro: "Welcome back!" });

    const sentCall = mocks.sendMessage.mock.calls[0] as unknown[];
    // First session gets "Primary" name by default, so intro is enriched with session identity
    const opts = sentCall[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("Welcome back!\n_Session 1 \u2014 Primary_");
  });

  it("enriches default intro with session identity when name is set", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "scout", sessionsActive: 1 });

    await call({ name: "scout" });

    const opts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("ℹ️ Session 2 — scout");
  });

  it("enriches default intro with session identity when multiple sessions active", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 3, pin: 333333, name: "Helper", sessionsActive: 2 });
    // Collision check: "Helper" not in list
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Primary" }]);
    // fellow_sessions post-creation
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }, { sid: 3, name: "Helper" }]);
    // Simulate operator approving
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro message

    await call({ name: "Helper" });

    // The intro message is the 2nd sendMessage call
    const opts = (mocks.sendMessage.mock.calls[1] as unknown[])[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("ℹ️ Session 3 — Helper");
  });

  it("appends session tag to custom intro when multiple sessions active", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 4, pin: 444444, name: "worker", sessionsActive: 3 });
    // Collision check (pre-creation — no "worker" yet)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "boss" }, { sid: 2, name: "helper" },
    ]);
    // fellow_sessions (post-creation — includes "worker")
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "boss" }, { sid: 2, name: "helper" }, { sid: 4, name: "worker" },
    ]);
    // Simulate operator approving
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 51 })   // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro message

    await call({ intro: "Hello!", name: "worker" });

    // The intro message is the 2nd sendMessage call
    const opts = (mocks.sendMessage.mock.calls[1] as unknown[])[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("Hello!\n_Session 4 — worker_");
  });

  it("omits discarded when nothing was pending", async () => {
    mocks.pendingCount.mockReturnValue(0);

    const result = parseResult(await call({}));

    expect(result.discarded).toBeUndefined();
  });

  it("calls createSession with provided name", async () => {
    mocks.pendingCount.mockReturnValue(0);

    await call({ name: "worker-bee" });

    expect(mocks.createSession).toHaveBeenCalledWith("worker-bee");
  });

  it("passes 'Primary' when name is omitted for first session", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 123456, name: "Primary", sessionsActive: 1 });

    await call({});

    expect(mocks.createSession).toHaveBeenCalledWith("Primary");
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
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

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
      name: "active-test",
      sessionsActive: 2,
    });
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "active-test" });

    expect(mocks.setActiveSession).toHaveBeenCalledWith(5);
  });

  // =========================================================================
  // Multi-session: fellow_sessions / routing_mode
  // =========================================================================

  it("includes fellow_sessions and routing_mode in fast-path result when sessionsActive > 1", async () => {
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
    mocks.getRoutingMode.mockReturnValue("cascade");
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro

    const result = parseResult(await call({ name: "scout" }));

    expect(result.action).toBe("fresh");
    expect(Array.isArray(result.fellow_sessions)).toBe(true);
    // Only the OTHER session is in fellow_sessions (not self)
    const fellows = result.fellow_sessions as Array<{ sid: number }>;
    expect(fellows.every(s => s.sid !== 4)).toBe(true);
    expect(fellows.some(s => s.sid === 3)).toBe(true);
    expect(result.routing_mode).toBe("cascade");
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
    mocks.getRoutingMode.mockReturnValue("load_balance");
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro
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
    expect(result.routing_mode).toBe("load_balance");
  });

  it("omits fellow_sessions when only one session is active", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "solo", sessionsActive: 1 });

    const result = parseResult(await call({ name: "solo" }));

    expect(result.fellow_sessions).toBeUndefined();
    expect(result.routing_mode).toBeUndefined();
  });

  it("returns an error and rolls back session when the intro message send fails", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 5, pin: 500005, name: undefined, sessionsActive: 1 });
    mocks.sendMessage.mockRejectedValue(new Error("network error"));
    const result = await call({});
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
    expect(mocks.createSession).toHaveBeenCalledWith("Scout");
  });

  it("first session gets 'Primary' default even when other sessions exist", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Primary", sessionsActive: 1 });

    const result = parseResult(await call({}));

    expect(result.sid).toBe(2);
    expect(mocks.createSession).toHaveBeenCalledWith("Primary");
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
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "Worker" });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("governor", 1);
  });

  it("does not set routing mode when first session starts", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "", sessionsActive: 1 });

    await call({});

    expect(mocks.setRoutingMode).not.toHaveBeenCalled();
  });

  it("routing_mode in result reflects governor after auto-activation", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    // Collision check
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
    ]);
    // allSessions
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);
    mocks.getRoutingMode.mockReturnValue("governor");
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    const result = parseResult(await call({ name: "Worker" }));

    expect(result.routing_mode).toBe("governor");
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
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "Late" });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("governor", 3);
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
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "Third" });

    expect(mocks.setRoutingMode).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Approval gate
  // =========================================================================

  it("first session is auto-approved without operator interaction", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", sessionsActive: 1 });

    const result = parseResult(await call({ name: "Primary" }));

    expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    expect(result.sid).toBe(1);
  });

  it("first session defaults name to 'Primary' when none provided", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 111111, name: "Primary", sessionsActive: 1 });

    await call({});

    expect(mocks.createSession).toHaveBeenCalledWith("Primary");
  });

  it("second session requires operator approval and succeeds on approve", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "Scout", sessionsActive: 2 });
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]);
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 200 })  // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro message
    // Simulate operator pressing Approve
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "cqid" } }); });
    });

    const result = parseResult(await call({ name: "Scout" }));

    expect(mocks.registerCallbackHook).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith("Scout");
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
  // Multi-session announcement (task 250)
  // =========================================================================

  it("notifies existing sessions when 2nd session joins", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Worker", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Primary", createdAt: "2026-03-17" }]) // collision check
      .mockReturnValue([                                                             // allSessions
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })   // approval prompt
      .mockResolvedValue(INTRO_MSG);               // intro

    await call({ name: "Worker" });

    // Should deliver a DM to existing session 1 about the new session joining
    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(
      2,          // senderSid = new session
      1,          // targetSid = existing session
      expect.stringContaining("Worker has joined"),
    );
  });

  it("does not notify when first session starts (no existing sessions)", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 1, pin: 100001, name: "Primary", sessionsActive: 1 });

    await call({});

    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("does not notify when 3rd session joins (only fires on 2nd)", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(2);
    mocks.createSession.mockReturnValue({ sid: 3, pin: 300003, name: "Scout", sessionsActive: 3 });
    mocks.listSessions
      .mockReturnValueOnce([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      ])
      .mockReturnValue([
        { sid: 1, name: "Primary", createdAt: "2026-03-17" },
        { sid: 2, name: "Worker", createdAt: "2026-03-17" },
        { sid: 3, name: "Scout", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "Scout" });

    // sessionsActive === 3, so no announcement DM
    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("announcement includes governor name", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 200002, name: "Scout", sessionsActive: 2 });
    mocks.listSessions
      .mockReturnValueOnce([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }])
      .mockReturnValue([
        { sid: 1, name: "Overseer", createdAt: "2026-03-17" },
        { sid: 2, name: "Scout", createdAt: "2026-03-17" },
      ]);
    mocks.registerCallbackHook.mockImplementationOnce((_id: number, fn: (evt: unknown) => void) => {
      void Promise.resolve().then(() => { fn({ content: { data: "approve_yes", qid: "q1" } }); });
    });
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 50 })
      .mockResolvedValue(INTRO_MSG);

    await call({ name: "Scout" });

    // DM should mention the joiner's name
    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(
      2, 1, expect.stringContaining("Scout has joined"),
    );
  });
});

