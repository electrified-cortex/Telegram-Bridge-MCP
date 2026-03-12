import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  recordOutgoing: vi.fn(),
  resetAnimationTimeout: vi.fn(),
  cancelTyping: vi.fn(),
  clearPendingTemp: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage }),
    resolveChat: () => 42,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: mocks.recordOutgoing,
}));

vi.mock("../animation-state.js", () => ({
  resetAnimationTimeout: mocks.resetAnimationTimeout,
}));

vi.mock("../typing-state.js", () => ({
  cancelTyping: mocks.cancelTyping,
}));

vi.mock("../temp-message.js", () => ({
  clearPendingTemp: mocks.clearPendingTemp,
}));

vi.mock("../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

import { register } from "./send_text.js";

const BASE_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

describe("send_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearPendingTemp.mockReturnValue(undefined);
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_text");
  });

  it("sends a basic text message and returns message_id", async () => {
    const result = await call({ text: "Hello" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(7);
  });

  it("calls sendMessage with correct chat_id and MarkdownV2 by default", async () => {
    await call({ text: "Hello" });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("passes reply_to_message_id via reply_parameters", async () => {
    await call({ text: "Reply", reply_to_message_id: 5 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_parameters: { message_id: 5 },
      }),
    );
  });

  it("passes disable_notification option", async () => {
    await call({ text: "Quiet", disable_notification: true });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ disable_notification: true }),
    );
  });

  it("uses raw MarkdownV2 when parse_mode is MarkdownV2", async () => {
    await call({ text: "*bold*", parse_mode: "MarkdownV2" });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      "*bold*",
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("uses HTML parse_mode when specified", async () => {
    await call({ text: "<b>bold</b>", parse_mode: "HTML" });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      "<b>bold</b>",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("returns EMPTY_MESSAGE error for empty text", async () => {
    const result = await call({ text: "" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("returns EMPTY_MESSAGE error for whitespace-only text", async () => {
    const result = await call({ text: "   " });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("calls recordOutgoing with message_id and original text", async () => {
    await call({ text: "Hello" });
    expect(mocks.recordOutgoing).toHaveBeenCalledWith(7, "text", "Hello");
  });

  it("calls resetAnimationTimeout", async () => {
    await call({ text: "Hello" });
    expect(mocks.resetAnimationTimeout).toHaveBeenCalledOnce();
  });

  it("calls cancelTyping before sending", async () => {
    await call({ text: "Hello" });
    expect(mocks.cancelTyping).toHaveBeenCalledOnce();
  });

  it("clears pending temp message before sending", async () => {
    await call({ text: "Hello" });
    expect(mocks.clearPendingTemp).toHaveBeenCalledOnce();
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request" }, "sendMessage", {}),
    );
    const result = await call({ text: "fail" });
    expect(isError(result)).toBe(true);
  });
});
