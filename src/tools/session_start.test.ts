import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";
import type { ButtonResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  pendingCount: vi.fn(),
  dequeue: vi.fn(),
  pollButtonPress: vi.fn(),
  ackAndEditSelection: vi.fn(),
  createSession: vi.fn(),
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
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: () => mocks.resolveChat(),
  };
});;

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: (...args: unknown[]) => mocks.pendingCount(...args),
  dequeue: (...args: unknown[]) => mocks.dequeue(...args),
}));

vi.mock("../session-manager.js", () => ({
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  setActiveSession: (...args: unknown[]) => mocks.setActiveSession(...args),
  listSessions: (...args: unknown[]) => mocks.listSessions(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getRoutingMode: () => mocks.getRoutingMode(),
}));

vi.mock("../session-queue.js", () => ({
  createSessionQueue: vi.fn(),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonPress: (...args: unknown[]) => mocks.pollButtonPress(...args),
    ackAndEditSelection: (...args: unknown[]) =>
      mocks.ackAndEditSelection(...args),
  };
});

import { register } from "./session_start.js";

const INTRO_MSG = { message_id: 100, chat: { id: 42 }, date: 0 };
const CONFIRM_MSG = { message_id: 101, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return {
    kind: "button",
    callback_query_id: "cq1",
    data,
    message_id: 101,
  };
}

describe("session_start tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(INTRO_MSG);
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
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

  it("passes MCP signal to pollButtonPress", async () => {
    mocks.pendingCount.mockReturnValue(1);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(null);

    const signal = new AbortController().signal;
    await call({}, { signal });

    expect(mocks.pollButtonPress).toHaveBeenCalledWith(42, 101, 600, signal);
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
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "boss" }, { sid: 2, name: "helper" }, { sid: 4, name: "worker" },
    ]);

    await call({ intro: "Hello!", name: "worker" });

    const opts = (mocks.sendMessage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("Hello!\n_Session 4 — worker_");
  });

  it("asks user and drains on Start Fresh", async () => {
    mocks.pendingCount.mockReturnValue(3);
    // After intro is sent, second sendMessage is the confirmation
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    // Simulate draining 3 messages
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce({ id: 3 })
      .mockReturnValueOnce(undefined);

    const result = parseResult(await call({}));

    expect(result).toEqual({
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "fresh",
      discarded: 3,
      intro_message_id: 100,
    });
    // Confirmation should have been ack'd
    expect(mocks.ackAndEditSelection).toHaveBeenCalledTimes(1);
  });

  it("asks user and returns resume with pending count", async () => {
    mocks.pendingCount.mockReturnValue(5);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_resume"),
    );

    const result = parseResult(await call({}));

    expect(result).toEqual({
      sid: 1,
      pin: 123456,
      sessions_active: 1,
      action: "resume",
      pending: 5,
      intro_message_id: 100,
    });
    expect(mocks.ackAndEditSelection).toHaveBeenCalledTimes(1);
  });

  it("sends confirmation with Start Fresh as first button", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce(undefined);

    await call({});

    // Second sendMessage call is the confirmation
    const confirmCall = mocks.sendMessage.mock.calls[1] as unknown[];
    const opts = confirmCall[2] as Record<string, unknown>;
    const markup = opts.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const buttons = markup.inline_keyboard[0];
    // "Start Fresh" should be the first (default) button
    expect(buttons[0].text).toContain("Start Fresh");
    expect(buttons[0].callback_data).toBe("session_fresh");
    expect(buttons[1].text).toContain("Resume");
    expect(buttons[1].callback_data).toBe("session_resume");
  });

  it("confirmation text includes pending count", async () => {
    mocks.pendingCount.mockReturnValue(7);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    // drain 7
    for (let i = 0; i < 7; i++) {
      mocks.dequeue.mockReturnValueOnce({ id: i + 1 });
    }
    mocks.dequeue.mockReturnValueOnce(undefined);

    await call({});

    const confirmCall = mocks.sendMessage.mock.calls[1] as unknown[];
    const rawText = (confirmCall[2] as Record<string, unknown>)
      ._rawText as string;
    expect(rawText).toContain("7");
    expect(rawText).toContain("message");
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

  it("includes fellow_sessions in resume result when sessionsActive > 1", async () => {
    mocks.pendingCount.mockReturnValue(3);
    mocks.createSession.mockReturnValue({ sid: 2, pin: 111111, name: "alpha", sessionsActive: 2 });
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "beta" },
      { sid: 2, name: "alpha" },
    ]);
    mocks.getRoutingMode.mockReturnValue("load_balance");
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(makeButtonResult("session_resume"));

    const result = parseResult(await call({ name: "alpha" }));

    expect(result.action).toBe("resume");
    const fellows = result.fellow_sessions as Array<{ sid: number }>;
    expect(fellows.some(s => s.sid === 1)).toBe(true);
    expect(fellows.every(s => s.sid !== 2)).toBe(true);
    expect(result.routing_mode).toBe("load_balance");
  });

  it("includes fellow_sessions in fresh+discard result when sessionsActive > 1", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.createSession.mockReturnValue({ sid: 6, pin: 666666, name: "gamma", sessionsActive: 2 });
    mocks.listSessions.mockReturnValue([
      { sid: 5, name: "delta" },
      { sid: 6, name: "gamma" },
    ]);
    mocks.getRoutingMode.mockReturnValue("load_balance");
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(makeButtonResult("session_fresh"));
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce(undefined);

    const result = parseResult(await call({ name: "gamma" }));

    expect(result.action).toBe("fresh");
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

  it("returns an error when the intro message send fails", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.sendMessage.mockRejectedValue(new Error("network error"));
    const result = await call({});
    expect(isError(result)).toBe(true);
  });

  it("returns error when chat is not configured", async () => {
    mocks.resolveChat.mockReturnValueOnce({ code: "UNAUTHORIZED_CHAT", message: "no chat" } as never);
    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
