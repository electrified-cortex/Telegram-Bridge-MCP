import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  listSessions: vi.fn(),
  deliverDirectMessage: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  listSessions: mocks.listSessions,
}));

vi.mock("../session-queue.js", () => ({
  deliverDirectMessage: (...args: unknown[]) =>
    mocks.deliverDirectMessage(...args),
}));

import { register } from "./notify_shutdown_warning.js";

describe("notify_shutdown_warning tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("notify_shutdown_warning");
  });

  it("notifies all other active sessions", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Governor", color: "🟦", createdAt: "" },
      { sid: 2, name: "Worker", color: "🟩", createdAt: "" },
    ]);
    mocks.deliverDirectMessage.mockReturnValue(true);

    const result = parseResult(await call({ token: 1111111 }));
    expect(result.notified).toBe(1);
    expect(mocks.deliverDirectMessage).toHaveBeenCalledTimes(1);
    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(1, 2, expect.stringContaining("session termination imminent"));
  });

  it("includes session/close instruction and token deletion in message", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Governor", color: "🟦", createdAt: "" },
      { sid: 2, name: "Worker", color: "🟩", createdAt: "" },
    ]);
    mocks.deliverDirectMessage.mockReturnValue(true);

    await call({ token: 1111111 });
    const [, , text] = mocks.deliverDirectMessage.mock.calls[0] as [number, number, string];
    expect(text).toContain("session/close");
    expect(text).toContain("delete stored session token");
  });

  it("excludes caller from recipients", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Governor", color: "🟦", createdAt: "" },
    ]);
    const result = parseResult(await call({ token: 1111111 }));
    expect(result.notified).toBe(0);
    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("includes reason in message when provided", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Gov", color: "🟦", createdAt: "" },
      { sid: 2, name: "W1", color: "🟩", createdAt: "" },
    ]);
    mocks.deliverDirectMessage.mockReturnValue(true);

    await call({ token: 1111111, reason: "code update" });
    const [, , text] = mocks.deliverDirectMessage.mock.calls[0] as [number, number, string];
    expect(text).toContain("code update");
  });

  it("includes wait_seconds in message when provided", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Gov", color: "🟦", createdAt: "" },
      { sid: 2, name: "W1", color: "🟩", createdAt: "" },
    ]);
    mocks.deliverDirectMessage.mockReturnValue(true);

    await call({ token: 1111111, wait_seconds: 30 });
    const [, , text] = mocks.deliverDirectMessage.mock.calls[0] as [number, number, string];
    expect(text).toContain("30");
  });

  it("notifies multiple sessions and counts successes", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Gov", color: "🟦", createdAt: "" },
      { sid: 2, name: "W1", color: "🟩", createdAt: "" },
      { sid: 3, name: "W2", color: "🟨", createdAt: "" },
    ]);
    mocks.deliverDirectMessage.mockReturnValue(true);

    const result = parseResult(await call({ token: 1111111 }));
    expect(result.notified).toBe(2);
    expect(mocks.deliverDirectMessage).toHaveBeenCalledTimes(2);
  });

  it("returns error when auth fails", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ token: 1999999 });
    expect(isError(result)).toBe(true);
    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("returns message when no other sessions are active", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Gov", color: "🟦", createdAt: "" },
    ]);
    const result = parseResult(await call({ token: 1111111 }));
    expect(result.notified).toBe(0);
    expect(result.message).toContain("No other sessions");
  });
});
