import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  closeSession: vi.fn(),
  validateSession: vi.fn(),
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
  revokeAllForSession: vi.fn(),
  getGovernorSid: vi.fn(),
  setRoutingMode: vi.fn(),
  sendServiceMessage: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  closeSession: (...args: unknown[]) => mocks.closeSession(...args),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
  getActiveSession: (...args: unknown[]) => mocks.getActiveSession(...args),
  setActiveSession: (...args: unknown[]) => mocks.setActiveSession(...args),
}));

vi.mock("../dm-permissions.js", () => ({
  revokeAllForSession: (...args: unknown[]) =>
    mocks.revokeAllForSession(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
  setRoutingMode: (...args: unknown[]) => mocks.setRoutingMode(...args),
}));

vi.mock("../telegram.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../telegram.js")>();
  return {
    ...orig,
    sendServiceMessage: (...args: unknown[]) =>
      mocks.sendServiceMessage(...args),
  };
});

import { register } from "./close_session.js";

describe("close_session tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.closeSession.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("close_session");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);

    const result = await call({ sid: 1, pin: 999999 });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("AUTH_FAILED");
  });

  it("closes an existing session", async () => {
    const result = parseResult(await call({ sid: 1, pin: 123456 }));

    expect(mocks.closeSession).toHaveBeenCalledWith(1);
    expect(result.closed).toBe(true);
    expect(result.sid).toBe(1);
  });

  it("returns not_found for nonexistent session", async () => {
    mocks.closeSession.mockReturnValue(false);

    const result = parseResult(await call({ sid: 99, pin: 123456 }));

    expect(result.closed).toBe(false);
    expect(result.sid).toBe(99);
  });

  it("validates credentials before closing", async () => {
    await call({ sid: 2, pin: 654321 });

    expect(mocks.validateSession).toHaveBeenCalledWith(2, 654321);
    // validateSession is called before closeSession
    const validateOrder = mocks.validateSession.mock.invocationCallOrder[0];
    const closeOrder = mocks.closeSession.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(closeOrder);
  });

  it("does not call closeSession when auth fails", async () => {
    mocks.validateSession.mockReturnValue(false);

    await call({ sid: 1, pin: 999999 });

    expect(mocks.closeSession).not.toHaveBeenCalled();
  });

  it("resets active session to 0 when closing the active session", async () => {
    mocks.getActiveSession.mockReturnValue(1);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setActiveSession).toHaveBeenCalledWith(0);
  });

  it("does not reset active session when closing a different session", async () => {
    mocks.getActiveSession.mockReturnValue(2);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setActiveSession).not.toHaveBeenCalled();
  });

  it("resets routing mode when governor session closes", async () => {
    mocks.getGovernorSid.mockReturnValue(1);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("load_balance");
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Governor session closed"),
    );
  });

  it("does not reset routing mode when non-governor closes", async () => {
    mocks.getGovernorSid.mockReturnValue(5);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).not.toHaveBeenCalled();
    expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
  });

  it("still returns success even if service message fails", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.sendServiceMessage.mockRejectedValue(new Error("network"));

    const result = parseResult(await call({ sid: 1, pin: 123456 }));
    expect(result.closed).toBe(true);
  });
});
