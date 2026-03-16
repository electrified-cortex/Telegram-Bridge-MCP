import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  getRoutingMode: vi.fn(),
  passMessage: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getRoutingMode: () => mocks.getRoutingMode(),
}));

vi.mock("../session-queue.js", () => ({
  passMessage: (...args: unknown[]) => mocks.passMessage(...args),
}));

import { register } from "./pass_message.js";

describe("pass_message tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getRoutingMode.mockReturnValue("cascade");
    mocks.passMessage.mockReturnValue(2);
    const server = createMockServer();
    register(server);
    call = server.getHandler("pass_message");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ sid: 1, pin: 999999, message_id: 100 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("rejects when not in cascade mode", async () => {
    mocks.getRoutingMode.mockReturnValue("load_balance");
    const result = await call({ sid: 1, pin: 123456, message_id: 100 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_CASCADE_MODE");
  });

  it("rejects when not in governor mode", async () => {
    mocks.getRoutingMode.mockReturnValue("governor");
    const result = await call({ sid: 1, pin: 123456, message_id: 100 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_CASCADE_MODE");
  });

  it("passes message to next session", async () => {
    mocks.passMessage.mockReturnValue(3);
    const result = await call({ sid: 1, pin: 123456, message_id: 100 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.passed).toBe(true);
    expect(data.forwarded_to).toBe(3);
    expect(mocks.passMessage).toHaveBeenCalledWith(1, 100);
  });

  it("returns error when pass fails (last session or message not found)", async () => {
    mocks.passMessage.mockReturnValue(0);
    const result = await call({ sid: 1, pin: 123456, message_id: 100 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("PASS_FAILED");
  });
});
