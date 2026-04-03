import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  transcribeWithIndicator: vi.fn(),
}));

vi.mock("../transcribe.js", () => ({
  transcribeWithIndicator: mocks.transcribeWithIndicator,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./transcribe_voice.js";

describe("transcribe_voice tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("transcribe_voice");
  });

  it("returns transcribed text for a file_id", async () => {
    mocks.transcribeWithIndicator.mockResolvedValue("hello world");
    const result = await call({ file_id: "abc123", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe("hello world");
    expect(mocks.transcribeWithIndicator).toHaveBeenCalledWith("abc123", undefined);
  });

  it("passes message_id to transcribeWithIndicator when provided", async () => {
    mocks.transcribeWithIndicator.mockResolvedValue("ok");
    await call({ file_id: "abc", message_id: 42, token: 1123456});
    expect(mocks.transcribeWithIndicator).toHaveBeenCalledWith("abc", 42);
  });

  it("returns an error result if transcription throws", async () => {
    mocks.transcribeWithIndicator.mockRejectedValue(new Error("model not found"));
    const result = await call({ file_id: "bad", token: 1123456});
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"file_id":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"file_id":"x","token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"file_id":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
