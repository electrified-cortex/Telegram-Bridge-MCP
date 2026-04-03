import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  getTopic: vi.fn<() => string | null>(),
  setTopic: vi.fn(),
  clearTopic: vi.fn(),
}));

vi.mock("../topic-state.js", () => ({
  getTopic: mocks.getTopic,
  setTopic: mocks.setTopic,
  clearTopic: mocks.clearTopic,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./set_topic.js";

describe("set_topic tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getTopic.mockReturnValue(null);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_topic");
  });

  it("sets a topic and returns { topic, previous, set: true }", async () => {
    mocks.getTopic.mockReturnValueOnce(null).mockReturnValueOnce("Refactor Agent");
    const result = await call({ topic: "Refactor Agent", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.set).toBe(true);
    expect(data.topic).toBe("Refactor Agent");
    expect(data.previous).toBeNull();
    expect(mocks.setTopic).toHaveBeenCalledWith("Refactor Agent");
  });

  it("replaces an existing topic", async () => {
    mocks.getTopic.mockReturnValueOnce("Old Topic").mockReturnValueOnce("New Topic");
    const result = await call({ topic: "New Topic", token: 1123456});
    const data = parseResult(result);
    expect(data.previous).toBe("Old Topic");
    expect(data.topic).toBe("New Topic");
  });

  it("clears topic when empty string passed", async () => {
    mocks.getTopic.mockReturnValueOnce("Refactor Agent");
    const result = await call({ topic: "", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cleared).toBe(true);
    expect(data.topic).toBeNull();
    expect(data.previous).toBe("Refactor Agent");
    expect(mocks.clearTopic).toHaveBeenCalledOnce();
    expect(mocks.setTopic).not.toHaveBeenCalled();
  });

  it("clears topic when whitespace-only string passed", async () => {
    mocks.getTopic.mockReturnValueOnce("Test Runner");
    const result = await call({ topic: "   ", token: 1123456});
    const data = parseResult(result);
    expect(data.cleared).toBe(true);
    expect(mocks.clearTopic).toHaveBeenCalledOnce();
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"topic":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"topic":"x","token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"topic":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
