import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendChatAction: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 123),
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

import { register } from "./send_chat_action.js";

describe("send_chat_action tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_chat_action");
  });

  it("sends typing action by default and returns ok:true", async () => {
    mocks.sendChatAction.mockResolvedValue(undefined);
    const result = await call({ action: "typing", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "typing");
  });

  it("sends record_voice action", async () => {
    mocks.sendChatAction.mockResolvedValue(undefined);
    await call({ action: "record_voice", token: 1123456});
    expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
  });

  it("sends upload_document action", async () => {
    mocks.sendChatAction.mockResolvedValue(undefined);
    await call({ action: "upload_document", token: 1123456});
    expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "upload_document");
  });

  it("returns error when resolveChat returns non-number", async () => {
    mocks.resolveChat.mockReturnValueOnce({ code: "UNAUTHORIZED_CHAT", message: "test" });
    const result = await call({ action: "typing", token: 1123456});
    expect(isError(result)).toBe(true);
  });

  it("returns error when sendChatAction throws", async () => {
    mocks.sendChatAction.mockRejectedValue(new Error("API error"));
    const result = await call({ action: "typing", token: 1123456});
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
