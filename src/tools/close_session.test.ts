import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  closeSession: vi.fn(),
  validateSession: vi.fn(),
  getSession: vi.fn(),
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  revokeAllForSession: vi.fn(),
  getGovernorSid: vi.fn(),
  setRoutingMode: vi.fn(),
  sendServiceMessage: vi.fn(),
  deliverDirectMessage: vi.fn(),
  drainQueue: vi.fn().mockReturnValue([]),
  routeToSession: vi.fn(),
  replaceSessionCallbackHooks: vi.fn(),
  answerCallbackQuery: vi.fn(),
  resolveChat: vi.fn().mockReturnValue(1001),
}));

vi.mock("../session-manager.js", () => ({
  closeSession: (...args: unknown[]) => mocks.closeSession(...args),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
  getSession: (...args: unknown[]) => mocks.getSession(...args),
  getActiveSession: (...args: unknown[]) => mocks.getActiveSession(...args),
  setActiveSession: (...args: unknown[]) => mocks.setActiveSession(...args),
  listSessions: (...args: unknown[]) => mocks.listSessions(...args),
}));

vi.mock("../session-queue.js", () => ({
  removeSessionQueue: vi.fn(),
  deliverDirectMessage: (...args: unknown[]) => mocks.deliverDirectMessage(...args),
  drainQueue: (...args: unknown[]) => mocks.drainQueue(...args),
  routeToSession: (...args: unknown[]) => mocks.routeToSession(...args),
}));

vi.mock("../message-store.js", () => ({
  replaceSessionCallbackHooks: (...args: unknown[]) => mocks.replaceSessionCallbackHooks(...args),
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
    resolveChat: () => mocks.resolveChat(),
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
    mocks.listSessions.mockReturnValue([]);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.getSession.mockReturnValue({ sid: 1, pin: 123456, name: "Alpha", createdAt: "2026-03-17" });
    mocks.drainQueue.mockReturnValue([]);
    mocks.resolveChat.mockReturnValue(1001);
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
    // disconnect notification is always sent, but no routing-change message
    expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("still returns success even if service message fails", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.sendServiceMessage.mockRejectedValue(new Error("network"));

    const result = parseResult(await call({ sid: 1, pin: 123456 }));
    expect(result.closed).toBe(true);
  });

  it("promotes next-lowest session to governor when governor closes with remaining sessions", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      { sid: 3, name: "Scout", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("governor", 2);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("promoted to governor"),
    );
  });

  it("resets routing to load_balance when governor closes with no remaining sessions", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([]); // no sessions remain

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("load_balance");
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Governor session closed"),
    );
  });

  it("promotes lowest remaining SID when sessions are out-of-order", async () => {
    mocks.getGovernorSid.mockReturnValue(2);
    mocks.listSessions.mockReturnValue([
      { sid: 5, name: "Late", createdAt: "2026-03-17" },
      { sid: 3, name: "Early", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 2, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("governor", 3);
  });

  it("uses session name in promotion message when 2+ remain", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Primary", createdAt: "2026-03-17" },
      { sid: 3, name: "Scout", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Primary"),
    );
  });

  it("uses Session N label when promoted session has no name (2+ remain)", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "", createdAt: "2026-03-17" },
      { sid: 3, name: "Scout", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Session 2"),
    );
  });

  // =========================================================================
  // 2 → 1 teardown: single-session mode restoration
  // =========================================================================

  it("resets routing to load_balance when dropping from 2 to 1 session (governor closes)", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("load_balance");
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("resets routing to load_balance when dropping from 2 to 1 session (non-governor closes)", async () => {
    mocks.getGovernorSid.mockReturnValue(1); // session 1 is governor, we're closing session 2
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 2, pin: 123456 });

    expect(mocks.setRoutingMode).toHaveBeenCalledWith("load_balance");
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("notifies remaining session via DM when dropping from 2 to 1", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(
      0,
      2,
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("does not deliver DM notification when last session closes", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("does not reset routing or deliver DM when 3 sessions remain after close", async () => {
    mocks.getGovernorSid.mockReturnValue(0); // no governor
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "A", createdAt: "2026-03-17" },
      { sid: 3, name: "B", createdAt: "2026-03-17" },
      { sid: 4, name: "C", createdAt: "2026-03-17" },
    ]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.setRoutingMode).not.toHaveBeenCalled();
    // Only the disconnect notification is sent — no routing-change message
    expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Disconnect notification
  // =========================================================================

  it("always sends operator disconnect notification with session name", async () => {
    mocks.getSession.mockReturnValue({ sid: 1, pin: 123456, name: "Orion", createdAt: "2026-03-17" });

    await call({ sid: 1, pin: 123456 });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Orion has disconnected."),
    );
  });

  it("uses 'Session N' label in disconnect notification when session has no name", async () => {
    mocks.getSession.mockReturnValue({ sid: 3, pin: 123456, name: "", createdAt: "2026-03-17" });

    await call({ sid: 3, pin: 123456 });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Session 3 has disconnected."),
    );
  });

  it("uses 'Session N' label when getSession returns undefined", async () => {
    mocks.getSession.mockReturnValue(undefined);

    await call({ sid: 5, pin: 123456 });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Session 5 has disconnected."),
    );
  });

  // =========================================================================
  // Orphaned queue rerouting
  // =========================================================================

  it("drains orphaned queue and reroutes events to remaining sessions", async () => {
    const orphanedEvent = { id: 99, event: "message", content: { type: "text" } };
    mocks.drainQueue.mockReturnValue([orphanedEvent]);
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Beta", createdAt: "2026-03-17" }]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.drainQueue).toHaveBeenCalledWith(1);
    expect(mocks.routeToSession).toHaveBeenCalledWith(orphanedEvent, "message");
  });

  it("reroutes callback events to the response lane", async () => {
    const callbackEvent = { id: 55, event: "callback", content: { type: "cb" } };
    mocks.drainQueue.mockReturnValue([callbackEvent]);
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Beta", createdAt: "2026-03-17" }]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.routeToSession).toHaveBeenCalledWith(callbackEvent, "response");
  });

  it("does not reroute orphaned events when no sessions remain", async () => {
    const orphanedEvent = { id: 99, event: "message", content: { type: "text" } };
    mocks.drainQueue.mockReturnValue([orphanedEvent]);
    mocks.listSessions.mockReturnValue([]); // no sessions

    await call({ sid: 1, pin: 123456 });

    expect(mocks.routeToSession).not.toHaveBeenCalled();
  });

  it("does not call routeToSession when queue is empty", async () => {
    mocks.drainQueue.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Beta", createdAt: "2026-03-17" }]);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.routeToSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Pending callback hook cleanup
  // =========================================================================

  it("replaces pending callback hooks with session-closed responders", async () => {
    await call({ sid: 1, pin: 123456 });

    expect(mocks.replaceSessionCallbackHooks).toHaveBeenCalledWith(
      1,
      expect.any(Function),
    );
  });

  it("does not replace hooks if session close fails", async () => {
    mocks.closeSession.mockReturnValue(false);

    await call({ sid: 1, pin: 123456 });

    expect(mocks.replaceSessionCallbackHooks).not.toHaveBeenCalled();
  });
});
