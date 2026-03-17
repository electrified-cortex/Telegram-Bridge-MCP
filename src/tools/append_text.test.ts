import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  editMessageText: vi.fn(),
  getMessage: vi.fn(),
  recordOutgoingEdit: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 42),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({ editMessageText: mocks.editMessageText }),
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../message-store.js", () => ({
  getMessage: mocks.getMessage,
  recordOutgoingEdit: mocks.recordOutgoingEdit,
  CURRENT: -1,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

import { register } from "./append_text.js";

describe("append_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("append_text");
  });

  it("appends text to existing message with default newline separator", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Line 1" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "Line 2" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.length).toBe("Line 1\nLine 2".length);
  });

  it("passes accumulated text to editMessageText", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Hello" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: " World" });
    // The text passed to editMessageText will be MarkdownV2-resolved
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      expect.any(String),
      expect.objectContaining({ parse_mode: expect.any(String) }),
    );
  });

  it("uses custom separator", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "A" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "B", separator: " | " });
    const data = parseResult(result);
    expect(data.length).toBe("A | B".length);
  });

  it("handles empty current text (first append)", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "First chunk" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.length).toBe("First chunk".length);
  });

  it("returns MESSAGE_NOT_FOUND when message is not in store", async () => {
    mocks.getMessage.mockReturnValue(undefined);
    const result = await call({ message_id: 10, text: "Fresh" });
    expect(isError(result)).toBe(true);
    expect(result.content[0].text).toContain("MESSAGE_NOT_FOUND");
  });

  it("calls recordOutgoingEdit with accumulated text", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "X" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "Y" });
    expect(mocks.recordOutgoingEdit).toHaveBeenCalledWith(10, "text", "X\nY");
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Old" } });
    mocks.editMessageText.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message is not modified" }, "editMessageText", {}),
    );
    const result = await call({ message_id: 10, text: "Same" });
    expect(isError(result)).toBe(true);
  });

  it("handles boolean result from editMessageText", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Inline" } });
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, text: "More" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Falls back to the passed message_id when API returns boolean
    expect(data.message_id).toBe(10);
  });

  it("uses MarkdownV2 parse mode by default", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "more" });
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("passes HTML parse_mode when specified", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "more", parse_mode: "HTML" });
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      "Text\nmore",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("returns error when message has non-text content type", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "voice" } });
    const result = await call({ message_id: 10, text: "oops" });
    expect(isError(result)).toBe(true);
    expect(result.content[0].text).toContain("MESSAGE_NOT_TEXT");
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 10, text: "x" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Old" } });
    mocks.validateText.mockReturnValueOnce({
      code: "TEXT_TOO_LONG",
      message: "too long",
    });
    const result = await call({ message_id: 10, text: "more" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("TEXT_TOO_LONG");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when multiple sessions active and no identity", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    const result = await call({"message_id":1,"text":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"message_id":1,"text":"x","identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when multiple sessions active and identity is valid", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"text":"x","identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

  it("proceeds when single session active and no identity (backward compat)", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(1);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"text":"x"})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
  });
});

});
