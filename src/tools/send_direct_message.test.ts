import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  getSession: vi.fn(),
  deliverDirectMessage: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getSession: mocks.getSession,
}));

vi.mock("../session-queue.js", () => ({
  deliverDirectMessage: (...args: unknown[]) =>
    mocks.deliverDirectMessage(...args),
}));

import { register } from "./send_direct_message.js";

describe("send_direct_message tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getSession.mockReturnValue({ identity: [2, 111111], name: "worker",
      createdAt: "2026-01-01T00:00:00Z",
    });
    mocks.deliverDirectMessage.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_direct_message");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ identity: [1, 999999], target_sid: 2, text: "hi",
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("rejects self-DM", async () => {
    const result = await call({ identity: [1, 123456], target_sid: 1, text: "hi",
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("DM_SELF");
  });

  it("rejects when target session does not exist", async () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = await call({ identity: [1, 123456], target_sid: 99, text: "hi",
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });

  it("delivers a DM successfully", async () => {
    const result = parseResult(
      await call({ identity: [1, 123456], target_sid: 2, text: "hello" }),
    );
    expect(result.delivered).toBe(true);
    expect(result.target_sid).toBe(2);
    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(1, 2, "hello");
  });

  it("reports delivery failure when queue missing", async () => {
    mocks.deliverDirectMessage.mockReturnValue(false);
    const result = await call({ identity: [1, 123456], target_sid: 2, text: "hi",
    });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("DM_DELIVERY_FAILED");
  });
});
