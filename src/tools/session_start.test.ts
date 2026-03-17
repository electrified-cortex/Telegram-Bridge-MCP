import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  pendingCount: vi.fn(),
  dequeue: vi.fn(),
  createSession: vi.fn(),
  closeSession: vi.fn(),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  getRoutingMode: vi.fn().mockReturnValue("load_balance"),
  resolveChat: vi.fn(() => 42 as number),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
    }),
    resolveChat: () => mocks.resolveChat(),
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: (...args: unknown[]) => mocks.pendingCount(...args),
  dequeue: (...args: unknown[]) => mocks.dequeue(...args),
}));

vi.mock("../session-manager.js", () => ({
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  closeSession: (...args: unknown[]) => mocks.closeSession(...args),
  setActiveSession: (...args: unknown[]) => mocks.setActiveSession(...args),
  listSessions: (...args: unknown[]) => mocks.listSessions(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getRoutingMode: () => mocks.getRoutingMode(),
}));

vi.mock("../session-queue.js", () => ({
  createSessionQueue: vi.fn(),
  removeSessionQueue: vi.fn(),
}));

import { register } from "./session_start.js";

const INTRO_MSG = { message_id: 100, chat: { id: 42 }, date: 0 };

describe("session_start tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(INTRO_MSG);
    mocks.createSession.mockReturnValue({
      sid: 1,
      pin: 123456,
      name: "",
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
    // The raw text should contain our custom intro
    const opts = sentCall[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("Welcome back!");
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
    mocks.createSession.mockReturnValue({ sid: 3, pin: 333333, name: "", sessionsActive: 2 });
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "leader" }, { sid: 3, name: "" }]);

    await call({});

    const opts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("ℹ️ Session 3");
  });

  it("appends session tag to custom intro when multiple sessions active", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 4, pin: 444444, name: "worker", sessionsActive: 3 });
    // First call: name collision check (pre-creation — no "worker" yet)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "boss" }, { sid: 2, name: "helper" },
    ]);
    // Second call: fellow_sessions (post-creation — includes "worker")
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "boss" }, { sid: 2, name: "helper" }, { sid: 4, name: "worker" },
    ]);

    await call({ intro: "Hello!", name: "worker" });

    const opts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
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

  it("passes empty string when name is omitted", async () => {
    mocks.pendingCount.mockReturnValue(0);

    await call({});

    expect(mocks.createSession).toHaveBeenCalledWith("");
  });

  it("returns session credentials from createSession", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({
      sid: 3,
      pin: 719304,
      name: "scout",
      sessionsActive: 3,
    });

    const result = parseResult(await call({ name: "scout" }));

    expect(result.sid).toBe(3);
    expect(result.pin).toBe(719304);
    expect(result.sessions_active).toBe(3);
  });

  it("calls setActiveSession with the new session SID", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({
      sid: 5,
      pin: 999999,
      name: "active-test",
      sessionsActive: 2,
    });

    await call({ name: "active-test" });

    expect(mocks.setActiveSession).toHaveBeenCalledWith(5);
  });

  // =========================================================================
  // Multi-session: fellow_sessions / routing_mode
  // =========================================================================

  it("includes fellow_sessions and routing_mode in fast-path result when sessionsActive > 1", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.createSession.mockReturnValue({ sid: 4, pin: 444444, name: "scout", sessionsActive: 2 });
    // First call: name collision check (pre-creation)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 3, name: "leader" },
    ]);
    // Second call: fellow_sessions (post-creation)
    mocks.listSessions.mockReturnValue([
      { sid: 3, name: "leader" },
      { sid: 4, name: "scout" },
    ]);
    mocks.getRoutingMode.mockReturnValue("cascade");

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
    mocks.createSession.mockReturnValue({ sid: 6, pin: 666666, name: "gamma", sessionsActive: 2 });
    // First call: name collision check (pre-creation)
    mocks.listSessions.mockReturnValueOnce([
      { sid: 5, name: "delta" },
    ]);
    // Second call: fellow_sessions (post-creation)
    mocks.listSessions.mockReturnValue([
      { sid: 5, name: "delta" },
      { sid: 6, name: "gamma" },
    ]);
    mocks.getRoutingMode.mockReturnValue("load_balance");
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

  it("allows empty name even when named sessions exist", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Overseer", createdAt: "2026-03-17" }]);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 222222, name: "", sessionsActive: 2 });

    const result = parseResult(await call({}));

    expect(result.sid).toBe(2);
    expect(mocks.createSession).toHaveBeenCalledWith("");
  });
});
