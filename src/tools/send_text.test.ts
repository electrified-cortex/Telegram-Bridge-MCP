import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
  splitMessage: vi.fn((text: string) => [text]),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage }),
    resolveChat: () => 42,
    splitMessage: mocks.splitMessage,
  };
});

vi.mock("../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./send_text.js";

const BASE_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

describe("send_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.validateSession.mockReturnValue(true);
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks.splitMessage.mockImplementation((text: string) => [text]);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_text");
  });

  it("sends a basic text message and returns message_id", async () => {
    const result = await call({ text: "Hello", identity: [1, 123456]});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(7);
  });

  it("calls sendMessage with correct chat_id and MarkdownV2 by default", async () => {
    await call({ text: "Hello", identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("passes reply_to_message_id via reply_parameters", async () => {
    await call({ text: "Reply", reply_to_message_id: 5, identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_parameters: { message_id: 5 },
      }),
    );
  });

  it("passes disable_notification option", async () => {
    await call({ text: "Quiet", disable_notification: true, identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ disable_notification: true }),
    );
  });

  it("uses raw MarkdownV2 when parse_mode is MarkdownV2", async () => {
    await call({ text: "*bold*", parse_mode: "MarkdownV2", identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      "*bold*",
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("uses HTML parse_mode when specified", async () => {
    await call({ text: "<b>bold</b>", parse_mode: "HTML", identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      "<b>bold</b>",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("returns EMPTY_MESSAGE error for empty text", async () => {
    const result = await call({ text: "", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("returns EMPTY_MESSAGE error for whitespace-only text", async () => {
    const result = await call({ text: "   ", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("passes _rawText in sendMessage opts for proxy recording", async () => {
    await call({ text: "Hello", identity: [1, 123456]});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ _rawText: "Hello" }),
    );
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request" }, "sendMessage", {}),
    );
    const result = await call({ text: "fail", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
  });

  it("sends multiple messages for split text and returns message_ids with split_count", async () => {
    mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
    mocks.sendMessage
      .mockResolvedValueOnce({ ...BASE_MSG, message_id: 10 })
      .mockResolvedValueOnce({ ...BASE_MSG, message_id: 11 });
    const result = await call({ text: "long text", reply_to_message_id: 3, identity: [1, 123456]});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_ids).toEqual([10, 11]);
    expect(data.split_count).toBe(2);
    expect(data.split).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    // reply_parameters only on first chunk
    expect(mocks.sendMessage.mock.calls[0][2]).toMatchObject({ reply_parameters: { message_id: 3 } });
    expect((mocks.sendMessage.mock.calls[1][2] as Record<string, unknown>).reply_parameters).toBeUndefined();
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"text":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"text":"x","identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"text":"x","identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
