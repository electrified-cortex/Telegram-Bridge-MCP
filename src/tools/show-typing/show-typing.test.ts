import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  showTyping: vi.fn(),
  cancelTyping: vi.fn(),
  resolveChat: vi.fn<() => number | { code: string; message: string }>(() => 99),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, resolveChat: mocks.resolveChat };
});

vi.mock("../../typing-state.js", () => ({
  showTyping: mocks.showTyping,
  cancelTyping: mocks.cancelTyping,
}));

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

// compaction-recovery is a no-op in show-typing tests
vi.mock("../../compaction-recovery.js", () => ({
  maybeReplaceRecoveringAnimation: vi.fn(() => Promise.resolve(false)),
}));

import { register } from "./show-typing.js";

describe("show_typing tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("show_typing");
  });

  it("calls showTyping with default timeout of 20", async () => {
    mocks.showTyping.mockResolvedValue(true);
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.showTyping).toHaveBeenCalledWith(20);
  });

  it("passes provided timeout to showTyping", async () => {
    mocks.showTyping.mockResolvedValue(true);
    const result = await call({ timeout_seconds: 60, token: 1123456});
    expect(isError(result)).toBe(false);
    expect(mocks.showTyping).toHaveBeenCalledWith(60);
  });

  it("succeeds when newly started", async () => {
    mocks.showTyping.mockResolvedValue(true);
    const result = await call({ timeout_seconds: 30, token: 1123456});
    expect(isError(result)).toBe(false);
  });

  it("succeeds when extending an existing indicator", async () => {
    mocks.showTyping.mockResolvedValue(false);
    const result = await call({ timeout_seconds: 30, token: 1123456});
    expect(isError(result)).toBe(false);
  });

  it("cancels the indicator when cancel:true and returns cancelled:true if was active", async () => {
    mocks.cancelTyping.mockReturnValue(true);
    const result = await call({ cancel: true, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cancelled).toBe(true);
    expect(mocks.showTyping).not.toHaveBeenCalled();
  });

  it("returns cancelled:false when cancel:true but indicator was not active", async () => {
    mocks.cancelTyping.mockReturnValue(false);
    const result = await call({ cancel: true, token: 1123456});
    const data = parseResult(result);
    expect(data.cancelled).toBe(false);
  });

  it("returns error when chat is not configured", async () => {
    mocks.resolveChat.mockReturnValueOnce({ code: "UNAUTHORIZED_CHAT", message: "no chat" });
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong suffix", async () => {
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
