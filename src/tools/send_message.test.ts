import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
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

vi.mock("../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

import { register } from "./send_message.js";

const BASE_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

describe("send_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_message");
  });

  it("sends a basic text message and returns message_id", async () => {
    const result = await call({ text: "Hello" });
    expect(isError(result)).toBe(false);
    expect(parseResult(result).message_id).toBe(7);
  });

  it("calls sendMessage with correct chat_id and MarkdownV2 by default", async () => {
    await call({ text: "Hello" });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("sends with inline keyboard when keyboard is provided", async () => {
    const result = await call({
      text: "Pick one",
      keyboard: [[{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]],
    });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[
            { text: "Yes", callback_data: "yes" },
            { text: "No", callback_data: "no" },
          ]],
        },
      }),
    );
  });

  it("includes style on buttons when provided", async () => {
    await call({
      text: "Go",
      keyboard: [[{ label: "OK", value: "ok", style: "success" }]],
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "OK", callback_data: "ok", style: "success" }]],
        },
      }),
    );
  });

  it("omits reply_markup when no keyboard is given", async () => {
    await call({ text: "Plain" });
    const opts = mocks.sendMessage.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.reply_markup).toBeUndefined();
  });

  it("passes reply_to_message_id via reply_parameters", async () => {
    await call({ text: "Reply", reply_to_message_id: 5 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ reply_parameters: { message_id: 5 } }),
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

  it("returns error for callback_data that is too long", async () => {
    const longValue = "x".repeat(65);
    const result = await call({
      text: "Pick",
      keyboard: [[{ label: "Btn", value: longValue }]],
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError(
        "e",
        { ok: false, error_code: 400, description: "Bad Request: chat not found" },
        "sendMessage",
        {},
      ),
    );
    const result = await call({ text: "Hello" });
    expect(isError(result)).toBe(true);
  });
});
