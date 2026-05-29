import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import { testIdentityGate } from "./test-helpers/identity-gate.js";

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

testIdentityGate((args) => call(args), mocks.validateSession);

});
