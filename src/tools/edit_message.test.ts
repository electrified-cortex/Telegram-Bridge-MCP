import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  editMessageText: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  resolveChat: vi.fn((): number | { code: string; message: string } => 42),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./edit_message.js";

describe("edit_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.validateSession.mockReturnValue(true);
    mocks.editMessageText.mockResolvedValue({ message_id: 1 });
    mocks.editMessageReplyMarkup.mockResolvedValue({ message_id: 1 });
    const server = createMockServer();
    register(server);
    call = server.getHandler("edit_message");
  });

  it("edits text only (no keyboard param) via editMessageText", async () => {
    const result = await call({ message_id: 1, text: "Updated", identity: [1, 123456]});
    expect(isError(result)).toBe(false);
    expect(parseResult(result).message_id).toBe(1);
    expect(mocks.editMessageText).toHaveBeenCalledWith(42, 1, expect.any(String), expect.any(Object));
    expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("edits text + keyboard together via editMessageText", async () => {
    const result = await call({
      message_id: 1,
      text: "Pick",
      keyboard: [[{ label: "Yes", value: "yes" }]],
      identity: [1, 123456],
    });
    expect(isError(result)).toBe(false);
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      1,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "Yes", callback_data: "yes" }]],
        },
      }),
    );
  });

  it("removes keyboard when keyboard: null is passed with text", async () => {
    await call({ message_id: 1, text: "Done", keyboard: null, identity: [1, 123456]});
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      1,
      expect.any(String),
      expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );
  });

  it("updates keyboard only (no text) via editMessageReplyMarkup", async () => {
    const result = await call({
      message_id: 1,
      keyboard: [[{ label: "OK", value: "ok", style: "success" }]],
      identity: [1, 123456],
    });
    expect(isError(result)).toBe(false);
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
      42,
      1,
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "OK", callback_data: "ok", style: "success" }]],
        },
      }),
    );
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("removes keyboard only (no text) via editMessageReplyMarkup with empty array", async () => {
    await call({ message_id: 1, keyboard: null, identity: [1, 123456]});
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
      42,
      1,
      expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("returns EMPTY_MESSAGE error when neither text nor keyboard is provided", async () => {
    const result = await call({ message_id: 1, identity: [1, 123456]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
  });

  it("returns error for invalid callback_data", async () => {
    const longValue = "x".repeat(65);
    const result = await call({
      message_id: 1,
      keyboard: [[{ label: "Btn", value: longValue }]],
      identity: [1, 123456],
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.editMessageText.mockRejectedValue(
      new GrammyError(
        "e",
        { ok: false, error_code: 400, description: "Bad Request: message can't be edited" },
        "editMessageText",
        {},
      ),
    );
    const result = await call({ message_id: 1, text: "New", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
  });

  it("returns BUTTON_LABEL_EXCEEDS_LIMIT for label > hard limit", async () => {
    const longLabel = "x".repeat(65);
    const result = await call({
      message_id: 1,
      keyboard: [[{ label: longLabel, value: "ok" }]],
      identity: [1, 123456],
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_EXCEEDS_LIMIT");
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 1, text: "x", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"message_id":1});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"message_id":1,"identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
