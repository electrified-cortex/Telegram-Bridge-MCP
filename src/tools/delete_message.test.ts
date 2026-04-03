import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  deleteMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 42),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./delete_message.js";

describe("delete_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("delete_message");
  });

  it("returns ok: true on success", async () => {
    mocks.deleteMessage.mockResolvedValue(true);
    const result = await call({ message_id: 5, token: 1123456});
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).ok).toBe(true);
  });

  it("passes chat_id and message_id to API", async () => {
    mocks.deleteMessage.mockResolvedValue(true);
    await call({ message_id: 99, token: 1123456});
    expect(mocks.deleteMessage).toHaveBeenCalledWith(42, 99);
  });

  it("returns MESSAGE_CANT_BE_DELETED for old or unauthorised messages", async () => {
    const { GrammyError } = await import("grammy");
    mocks.deleteMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" }, "deleteMessage", {})
    );
    const result = await call({ message_id: 1, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_CANT_BE_DELETED");
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 1, token: 1123456});
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
    const result = await call({"message_id":1,"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
