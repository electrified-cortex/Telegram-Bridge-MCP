import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./send_message.js";

describe("send_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_message");
  });

  it("sends a message and returns message_id and chat_id", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 123 }, date: 1000, text: "hi" });
    const result = await call({ chat_id: "123", text: "hi" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.message_id).toBe(1);
    expect(data.chat_id).toBe(123);
  });

  it("passes parse_mode and reply_markup to API", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 2, chat: { id: 1 }, date: 0, text: "x" });
    const markup = { inline_keyboard: [[{ text: "A", callback_data: "a" }]] };
    await call({ chat_id: "1", text: "x", parse_mode: "HTML", reply_markup: markup });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("HTML");
    expect(opts.reply_markup).toEqual(markup);
  });

  it("returns EMPTY_MESSAGE without calling API", async () => {
    const result = await call({ chat_id: "1", text: "" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("returns MESSAGE_TOO_LONG for text over 4096 chars", async () => {
    const result = await call({ chat_id: "1", text: "a".repeat(4097) });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("maps CHAT_NOT_FOUND from GrammyError", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "sendMessage", {})
    );
    const result = await call({ chat_id: "bad", text: "hi" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });
});
