import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  getSession: vi.fn(),
  getRoutingMode: vi.fn(),
  getGovernorSid: vi.fn(),
  routeMessage: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getRoutingMode: () => mocks.getRoutingMode(),
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../session-queue.js", () => ({
  routeMessage: (...args: unknown[]) => mocks.routeMessage(...args),
}));

import { register } from "./route_message.js";

describe("route_message tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getRoutingMode.mockReturnValue("governor");
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.getSession.mockReturnValue({
      sid: 2, pin: 111111, name: "worker",
      createdAt: "2026-01-01T00:00:00Z",
    });
    mocks.routeMessage.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("route_message");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({
      sid: 1, pin: 999999, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("rejects when not in governor mode", async () => {
    mocks.getRoutingMode.mockReturnValue("cascade");
    const result = await call({
      sid: 1, pin: 123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_GOVERNOR_MODE");
  });

  it("rejects when caller is not the governor", async () => {
    mocks.getGovernorSid.mockReturnValue(5);
    const result = await call({
      sid: 1, pin: 123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_GOVERNOR");
  });

  it("rejects when target session does not exist", async () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = await call({
      sid: 1, pin: 123456, message_id: 100, target_sid: 99,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });

  it("routes message to target session", async () => {
    const result = await call({
      sid: 1, pin: 123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.routed).toBe(true);
    expect(data.target_sid).toBe(2);
    expect(mocks.routeMessage).toHaveBeenCalledWith(100, 2);
  });

  it("returns error when route fails", async () => {
    mocks.routeMessage.mockReturnValue(false);
    const result = await call({
      sid: 1, pin: 123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("ROUTE_FAILED");
  });
});
