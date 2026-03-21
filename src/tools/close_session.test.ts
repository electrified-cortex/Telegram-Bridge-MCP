import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  closeSession: vi.fn(),
  validateSession: vi.fn(),
  getSession: vi.fn(),
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  getSessionAnnouncementMessage: vi.fn().mockReturnValue(undefined),
  revokeAllForSession: vi.fn(),
  getGovernorSid: vi.fn(),
  setGovernorSid: vi.fn(),
  sendServiceMessage: vi.fn(),
  deliverDirectMessage: vi.fn(),
  deliverServiceMessage: vi.fn(),
  drainQueue: vi.fn().mockReturnValue([]),
  routeToSession: vi.fn(),
  replaceSessionCallbackHooks: vi.fn(),
  answerCallbackQuery: vi.fn(),
  unpinChatMessage: vi.fn().mockResolvedValue(undefined),
  resolveChat: vi.fn().mockReturnValue(1001),
}));

vi.mock("../session-manager.js", () => ({
  closeSession: mocks.closeSession,
  validateSession: mocks.validateSession,
  getSession: mocks.getSession,
  getActiveSession: mocks.getActiveSession,
  setActiveSession: mocks.setActiveSession,
  listSessions: mocks.listSessions,
  getSessionAnnouncementMessage: (...args: unknown[]) => mocks.getSessionAnnouncementMessage(...args),
}));

vi.mock("../session-queue.js", () => ({
  removeSessionQueue: vi.fn(),
  deliverDirectMessage: mocks.deliverDirectMessage,
  deliverServiceMessage: mocks.deliverServiceMessage,
  drainQueue: mocks.drainQueue,
  routeToSession: mocks.routeToSession,
}));

vi.mock("../message-store.js", () => ({
  replaceSessionCallbackHooks: mocks.replaceSessionCallbackHooks,
}));

vi.mock("../dm-permissions.js", () => ({
  revokeAllForSession: (...args: unknown[]) =>
    mocks.revokeAllForSession(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
  setGovernorSid: mocks.setGovernorSid,
}));

vi.mock("../built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: vi.fn() };
});

vi.mock("../telegram.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../telegram.js")>();
  return {
    ...orig,
    sendServiceMessage: (...args: unknown[]) =>
      mocks.sendServiceMessage(...args),
    resolveChat: () => mocks.resolveChat(),
    getApi: () => ({
      unpinChatMessage: mocks.unpinChatMessage,
    }),
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
    mocks.getSession.mockReturnValue({ identity: [1, 123456], name: "Alpha", createdAt: "2026-03-17" });
    mocks.drainQueue.mockReturnValue([]);
    mocks.resolveChat.mockReturnValue(1001);
    const server = createMockServer();
    register(server);
    call = server.getHandler("close_session");
  });

  it("rejects invalid credentials", async () => {
    mocks.validateSession.mockReturnValue(false);

    const result = await call({ identity: [1, 999999] });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("AUTH_FAILED");
  });

  it("closes an existing session", async () => {
    const result = parseResult(await call({ identity: [1, 123456] }));

    expect(mocks.closeSession).toHaveBeenCalledWith(1);
    expect(result.closed).toBe(true);
    expect(result.sid).toBe(1);
  });

  it("returns not_found for nonexistent session", async () => {
    mocks.closeSession.mockReturnValue(false);

    const result = parseResult(await call({ identity: [99, 123456] }));

    expect(result.closed).toBe(false);
    expect(result.sid).toBe(99);
  });

  it("validates credentials before closing", async () => {
    await call({ identity: [2, 654321] });

    expect(mocks.validateSession).toHaveBeenCalledWith(2, 654321);
    // validateSession is called before closeSession
    const validateOrder = mocks.validateSession.mock.invocationCallOrder[0];
    const closeOrder = mocks.closeSession.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(closeOrder);
  });

  it("does not call closeSession when auth fails", async () => {
    mocks.validateSession.mockReturnValue(false);

    await call({ identity: [1, 999999] });

    expect(mocks.closeSession).not.toHaveBeenCalled();
  });

  it("resets active session to 0 when closing the active session", async () => {
    mocks.getActiveSession.mockReturnValue(1);

    await call({ identity: [1, 123456] });

    expect(mocks.setActiveSession).toHaveBeenCalledWith(0);
  });

  it("does not reset active session when closing a different session", async () => {
    mocks.getActiveSession.mockReturnValue(2);

    await call({ identity: [1, 123456] });

    expect(mocks.setActiveSession).not.toHaveBeenCalled();
  });

  it("clears governor SID when governor session closes", async () => {
    mocks.getGovernorSid.mockReturnValue(1);

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(0);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Governor session closed"),
    );
  });

  it("does not change governor SID when non-governor closes", async () => {
    mocks.getGovernorSid.mockReturnValue(5);

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).not.toHaveBeenCalled();
    // disconnect notification is always sent, but no routing-change message
    expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("has disconnected"),
    );
  });

  it("still returns success even if service message fails", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.sendServiceMessage.mockRejectedValue(new Error("network"));

    const result = parseResult(await call({ identity: [1, 123456] }));
    expect(result.closed).toBe(true);
  });

  it("promotes next-lowest session to governor when governor closes with remaining sessions", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
      { sid: 3, name: "Scout", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(2);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("promoted to governor"),
    );
  });

  it("clears governor SID when governor closes with no remaining sessions", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([]); // no sessions remain

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(0);
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

    await call({ identity: [2, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(3);
  });

  it("uses session name in promotion message when 2+ remain", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Primary", createdAt: "2026-03-17" },
      { sid: 3, name: "Scout", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

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

    await call({ identity: [1, 123456] });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Session 2"),
    );
  });

  // =========================================================================
  // 2 → 1 teardown: single-session mode restoration
  // =========================================================================

  it("clears governor SID when dropping from 2 to 1 session (governor closes)", async () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(0);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("clears governor SID when dropping from 2 to 1 session (non-governor closes)", async () => {
    mocks.getGovernorSid.mockReturnValue(1); // session 1 is governor, we're closing session 2
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [2, 123456] });

    expect(mocks.setGovernorSid).toHaveBeenCalledWith(0);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("notifies remaining session via DM when dropping from 2 to 1", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

    expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(
      0,
      2,
      expect.stringContaining("Single-session mode restored"),
    );
  });

  it("unpins remaining session announcement when closing from 2 to 1 sessions", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);
    // First call: closing session has no announcement; second call: remaining session has msg 88
    mocks.getSessionAnnouncementMessage
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(88);

    await call({ identity: [1, 123456] });

    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1001, 88);
  });

  it("does not unpin remaining session announcement when none is stored", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Worker", createdAt: "2026-03-17" },
    ]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);

    await call({ identity: [1, 123456] });

    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("does not deliver DM notification when last session closes", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);

    await call({ identity: [1, 123456] });

    expect(mocks.deliverDirectMessage).not.toHaveBeenCalled();
  });

  it("does not change governor SID or deliver DM when 3 sessions remain after close", async () => {
    mocks.getGovernorSid.mockReturnValue(0); // no governor
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "A", createdAt: "2026-03-17" },
      { sid: 3, name: "B", createdAt: "2026-03-17" },
      { sid: 4, name: "C", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

    expect(mocks.setGovernorSid).not.toHaveBeenCalled();
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
    mocks.getSession.mockReturnValue({ identity: [1, 123456], name: "Orion", createdAt: "2026-03-17" });

    await call({ identity: [1, 123456] });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Orion has disconnected."),
    );
  });

  it("uses 'Session N' label in disconnect notification when session has no name", async () => {
    mocks.getSession.mockReturnValue({ identity: [3, 123456], name: "", createdAt: "2026-03-17" });

    await call({ identity: [3, 123456] });

    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Session 3 has disconnected."),
    );
  });

  it("uses 'Session N' label when getSession returns undefined", async () => {
    mocks.getSession.mockReturnValue(undefined);

    await call({ identity: [5, 123456] });

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

    await call({ identity: [1, 123456] });

    expect(mocks.drainQueue).toHaveBeenCalledWith(1);
    expect(mocks.routeToSession).toHaveBeenCalledWith(orphanedEvent);
  });

  it("reroutes callback events to the response lane", async () => {
    const callbackEvent = { id: 55, event: "callback", content: { type: "cb" } };
    mocks.drainQueue.mockReturnValue([callbackEvent]);
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Beta", createdAt: "2026-03-17" }]);

    await call({ identity: [1, 123456] });

    expect(mocks.routeToSession).toHaveBeenCalledWith(callbackEvent);
  });

  it("does not reroute orphaned events when no sessions remain", async () => {
    const orphanedEvent = { id: 99, event: "message", content: { type: "text" } };
    mocks.drainQueue.mockReturnValue([orphanedEvent]);
    mocks.listSessions.mockReturnValue([]); // no sessions

    await call({ identity: [1, 123456] });

    expect(mocks.routeToSession).not.toHaveBeenCalled();
  });

  it("does not call routeToSession when queue is empty", async () => {
    mocks.drainQueue.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Beta", createdAt: "2026-03-17" }]);

    await call({ identity: [1, 123456] });

    expect(mocks.routeToSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Pending callback hook cleanup
  // =========================================================================

  it("replaces pending callback hooks with session-closed responders", async () => {
    await call({ identity: [1, 123456] });

    expect(mocks.replaceSessionCallbackHooks).toHaveBeenCalledWith(
      1,
      expect.any(Function),
    );
  });

  it("does not replace hooks if session close fails", async () => {
    mocks.closeSession.mockReturnValue(false);

    await call({ identity: [1, 123456] });

    expect(mocks.replaceSessionCallbackHooks).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Service messages on session lifecycle (task 285)
  // =========================================================================

  it("sends session_closed service message to remaining session when non-governor closes", async () => {
    mocks.getGovernorSid.mockReturnValue(0); // no governor (single-session logic)
    mocks.getSession.mockReturnValue({ identity: [1, 123456], name: "Worker", createdAt: "2026-03-17" });
    mocks.listSessions.mockReturnValue([{ sid: 2, name: "Primary", createdAt: "2026-03-17" }]);

    await call({ identity: [1, 123456] });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const toRemaining = calls.find((c: unknown[]) => c[0] === 2);
    expect(toRemaining).toBeDefined();
    expect(toRemaining![2]).toBe("session_closed");
    expect(String(toRemaining![1])).toContain("Worker");
  });

  it("sends governor_promoted service message to newly promoted session", async () => {
    mocks.getGovernorSid.mockReturnValue(1); // closing session is governor
    mocks.getSession.mockReturnValue({ identity: [1, 123456], name: "Primary", createdAt: "2026-03-17" });
    mocks.listSessions.mockReturnValue([
      { sid: 2, name: "Scout", createdAt: "2026-03-17" },
      { sid: 3, name: "Helper", createdAt: "2026-03-17" },
    ]);

    await call({ identity: [1, 123456] });

    const calls = mocks.deliverServiceMessage.mock.calls;
    const promotionMsg = calls.find((c: unknown[]) => c[2] === "governor_promoted");
    expect(promotionMsg).toBeDefined();
    expect(promotionMsg![0]).toBe(2); // lowest SID promoted
    expect(String(promotionMsg![1])).toContain("governor");

    // Other remaining session gets session_closed
    const closedMsg = calls.find((c: unknown[]) => c[0] === 3 && c[2] === "session_closed");
    expect(closedMsg).toBeDefined();
  });

  it("does not send service messages when last session closes", async () => {
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([]);

    await call({ identity: [1, 123456] });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Self-close regression (Task 150)
  // Root cause: "close_session currently disabled" was reported by an AI agent
  // (client-side reasoning), NOT by the server. The server never disables this
  // tool — it is always registered with enabled: true and accepts any SID+PIN,
  // including a session closing itself with its own credentials.
  // =========================================================================

  it("a session can self-close using its own credentials (no server-side restriction)", async () => {
    mocks.getSession.mockReturnValue({ identity: [2, 222222], name: "Scout", createdAt: "2026-03-17" });

    const result = parseResult(await call({ identity: [2, 222222] }));

    expect(result.closed).toBe(true);
    expect(result.sid).toBe(2);
    expect(mocks.closeSession).toHaveBeenCalledWith(2);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("🤖 Scout has disconnected."),
    );
  });

  it("does not drain queue when closeSession returns false", async () => {
    mocks.closeSession.mockReturnValue(false);

    const result = parseResult(await call({ identity: [1, 123456] }));

    expect(result.closed).toBe(false);
    expect(mocks.drainQueue).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Unpin announcement message on close (task 022)
  // =========================================================================

  it("unpins the announcement message when one is stored for the session", async () => {
    mocks.getSessionAnnouncementMessage.mockReturnValue(77);

    await call({ identity: [1, 123456] });

    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1001, 77);
  });

  it("does not call unpinChatMessage when no announcement message is stored", async () => {
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);

    await call({ identity: [1, 123456] });

    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when resolveChat returns a non-number", async () => {
    mocks.getSessionAnnouncementMessage.mockReturnValue(77);
    mocks.resolveChat.mockReturnValue({ code: "UNAUTHORIZED_CHAT", message: "no chat" } as never);

    await call({ identity: [1, 123456] });

    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });
});
