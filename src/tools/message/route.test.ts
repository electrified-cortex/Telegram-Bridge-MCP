import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  getSession: vi.fn(),
  getGovernorSid: vi.fn(),
  routeMessage: vi.fn(),
  deliverServiceMessage: vi.fn(),
  markFirstUseHintSeen: vi.fn((..._args: unknown[]) => false),
}));

vi.mock("../../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getSession: mocks.getSession,
  getOrInitHintsSeen: () => new Set<string>(),
}));

vi.mock("../../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../../session-queue.js", () => ({
  routeMessage: mocks.routeMessage,
  deliverServiceMessage: (...args: unknown[]) => mocks.deliverServiceMessage(...args),
}));

vi.mock("../../first-use-hints.js", () => ({
  markFirstUseHintSeen: (...args: unknown[]) => mocks.markFirstUseHintSeen(...args),
}));

import { register } from "./route.js";

describe("route_message tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.getSession.mockReturnValue({ identity: [2, 111111], name: "worker",
      createdAt: "2026-01-01T00:00:00Z",
    });
    mocks.routeMessage.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("route_message");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ token: 1999999, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("rejects when no governor is active", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    const result = await call({ token: 1123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_GOVERNOR_MODE");
  });

  it("rejects when caller is not the governor", async () => {
    mocks.getGovernorSid.mockReturnValue(5);
    const result = await call({ token: 1123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_GOVERNOR");
  });

  it("rejects when target session does not exist", async () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = await call({ token: 1123456, message_id: 100, target_sid: 99,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });

  it("routes message to target session", async () => {
    const result = await call({ token: 1123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.target_sid).toBe(2);
    expect(mocks.routeMessage).toHaveBeenCalledWith(100, 2, 1);
  });

  it("returns error when route fails", async () => {
    mocks.routeMessage.mockReturnValue(false);
    const result = await call({ token: 1123456, message_id: 100, target_sid: 2,
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("ROUTE_FAILED");
  });

  it("coerces target_sid from string to integer", async () => {
    const result = parseResult(
      await call({ token: 1123456, message_id: 100, target_sid: "2" }),
    );
    expect(result.target_sid).toBe(2);
    expect(mocks.routeMessage).toHaveBeenCalledWith(100, 2, 1);
  });
});
