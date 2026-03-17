import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  editMessageText: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 42),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoingEdit: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

import { register } from "./edit_message_text.js";

describe("edit_message_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("edit_message_text");
  });

  it("calls API with correct positional args", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 1 });
    await call({ message_id: 1, text: "Updated" });
    expect(mocks.editMessageText).toHaveBeenCalledWith(42, 1, "Updated", expect.any(Object));
  });

  it("returns result from API", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 1, text: "Updated" });
    const result = await call({ message_id: 1, text: "Updated" });
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({ message_id: 1 });
  });

  it("returns error when message cannot be edited", async () => {
    const { GrammyError } = await import("grammy");
    mocks.editMessageText.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message can't be edited" }, "editMessageText", {})
    );
    const result = await call({ message_id: 99, text: "x" });
    expect(isError(result)).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 1, text: "x" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "TEXT_TOO_LONG",
      message: "too long",
    });
    const result = await call({ message_id: 1, text: "x" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("TEXT_TOO_LONG");
  });

  it("handles boolean result from API (channel case)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 7, text: "Updated" });
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({ message_id: 7 });
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
