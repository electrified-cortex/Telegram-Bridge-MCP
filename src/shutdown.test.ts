import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setMyCommands: vi.fn(),
  unpinChatMessage: vi.fn((): Promise<void> => Promise.resolve()),
  resolveChat: vi.fn((): number | string => 123),
  sendServiceMessage: vi.fn((): Promise<void> => Promise.resolve()),
  stopPoller: vi.fn(),
  waitForPollerExit: vi.fn((): Promise<void> => Promise.resolve()),
  drainPendingUpdates: vi.fn((): Promise<void> => Promise.resolve()),
  listSessions: vi.fn((): Array<{ sid: number; name: string }> => []),
  getSessionAnnouncementMessage: vi.fn((_sid: number): number | undefined => undefined),
  deliverServiceMessage: vi.fn((): boolean => true),
  notifySessionWaiters: vi.fn(),
  getSessionLogMode: vi.fn((): "manual" | number | null => null),
  flushCurrentLog: vi.fn((): Promise<void> => Promise.resolve()),
  isLoggingEnabled: vi.fn((): boolean => true),
  rollLog: vi.fn((): string | null => null),
  closeSessionById: vi.fn((): { closed: boolean; sid: number } => ({ closed: true, sid: 0 })),
}));

vi.mock("./telegram.js", () => ({
  getApi: () => ({ setMyCommands: mocks.setMyCommands, unpinChatMessage: mocks.unpinChatMessage }),
  resolveChat: mocks.resolveChat,
  sendServiceMessage: mocks.sendServiceMessage,
}));

vi.mock("./poller.js", () => ({
  stopPoller: mocks.stopPoller,
  waitForPollerExit: mocks.waitForPollerExit,
  drainPendingUpdates: mocks.drainPendingUpdates,
}));

vi.mock("./session-manager.js", () => ({
  listSessions: mocks.listSessions,
  getSessionAnnouncementMessage: mocks.getSessionAnnouncementMessage,
}));

vi.mock("./session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
  notifySessionWaiters: mocks.notifySessionWaiters,
}));

vi.mock("./config.js", () => ({
  getSessionLogMode: mocks.getSessionLogMode,
}));

vi.mock("./local-log.js", () => ({
  flushCurrentLog: mocks.flushCurrentLog,
  isLoggingEnabled: mocks.isLoggingEnabled,
  rollLog: mocks.rollLog,
}));

vi.mock("./session-teardown.js", () => ({
  closeSessionById: mocks.closeSessionById,
}));

import {
  clearCommandsOnShutdown,
  elegantShutdown,
  setShutdownDumpHook,
  postShutdownAnnouncement,
  postSessionClosedLine,
  postSessionSummaryLine,
  postGravestone,
} from "./shutdown.js";

describe("shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyCommands.mockResolvedValue(true);
  });

  it("clears chat-scoped and default-scoped commands", async () => {
    await clearCommandsOnShutdown();
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(2);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "chat", chat_id: 123 } },
    );
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "default" } },
    );
  });

  it("still clears default scope when chat scope fails", async () => {
    mocks.setMyCommands
      .mockRejectedValueOnce(new Error("no permission"))
      .mockResolvedValueOnce(true);
    await clearCommandsOnShutdown();
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(2);
  });

  it("swallows errors for both scopes", async () => {
    mocks.setMyCommands.mockRejectedValue(new Error("fail"));
    await expect(clearCommandsOnShutdown()).resolves.toBeUndefined();
  });

  it("skips chat scope when resolveChat returns non-number", async () => {
    mocks.resolveChat.mockReturnValue("not configured");
    await clearCommandsOnShutdown();
    // Only default scope call
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(1);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "default" } },
    );
  });
});

describe("shutdown announcement helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveChat.mockReturnValue(123);
  });

  it("postShutdownAnnouncement sends operator cause with session count", async () => {
    await postShutdownAnnouncement("operator", 3);
    expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("operator /shutdown");
    expect(text).toContain("closing 3 active sessions");
    expect(text).toContain("pnpm start");
  });

  it("postShutdownAnnouncement uses singular for 1 session", async () => {
    await postShutdownAnnouncement("agent", 1);
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("closing 1 active session");
    // Guard against plural regression: must say "1 active session" not "1 active sessions"
    expect(text).not.toContain("active sessions,");
  });

  it("postShutdownAnnouncement mentions no active sessions when count is 0", async () => {
    await postShutdownAnnouncement("operator", 0);
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("no active sessions");
  });

  it("postShutdownAnnouncement swallows Telegram errors", async () => {
    mocks.sendServiceMessage.mockRejectedValue(new Error("network error"));
    await expect(postShutdownAnnouncement("agent", 2)).resolves.toBeUndefined();
  });

  it("postSessionClosedLine sends the session name and SID", async () => {
    await postSessionClosedLine("Worker 1", 5);
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("Worker 1");
    expect(text).toContain("SID 5");
  });

  it("postSessionClosedLine swallows Telegram errors", async () => {
    mocks.sendServiceMessage.mockRejectedValue(new Error("timeout"));
    await expect(postSessionClosedLine("A", 1)).resolves.toBeUndefined();
  });

  it("postSessionSummaryLine includes the count", async () => {
    await postSessionSummaryLine(12);
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("12");
    expect(text).toContain("sessions closed");
  });

  it("postGravestone sends the offline marker", async () => {
    await postGravestone();
    const text = mocks.sendServiceMessage.mock.calls[0]?.[0] as string;
    expect(text).toContain("Bridge offline");
  });

  it("postGravestone swallows Telegram errors", async () => {
    mocks.sendServiceMessage.mockRejectedValue(new Error("timeout"));
    await expect(postGravestone()).resolves.toBeUndefined();
  });
});

describe("elegantShutdown", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyCommands.mockResolvedValue(true);
    mocks.resolveChat.mockReturnValue(123);
    mocks.getSessionLogMode.mockReturnValue(null);
    mocks.isLoggingEnabled.mockReturnValue(true);
    mocks.rollLog.mockReturnValue(null);
    // Prevent process.exit from actually killing the test runner
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("stops poller, waits for exit, and drains pending updates", async () => {
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "A" }]);
    await elegantShutdown();
    expect(mocks.stopPoller).toHaveBeenCalledTimes(1);
    expect(mocks.waitForPollerExit).toHaveBeenCalledTimes(1);
    expect(mocks.drainPendingUpdates).toHaveBeenCalledTimes(1);
  });

  it("delivers shutdown service message to all active sessions", async () => {
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "Overseer" },
      { sid: 2, name: "Worker" },
    ]);

    await elegantShutdown();

    expect(mocks.deliverServiceMessage).toHaveBeenCalledTimes(2);
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ text: expect.stringContaining("shutting down"), eventType: "shutdown" }),
    );
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining("shutting down"), eventType: "shutdown" }),
    );
  });

  it("notifies session waiters after delivering shutdown messages", async () => {
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "A" }]);
    await elegantShutdown();
    expect(mocks.notifySessionWaiters).toHaveBeenCalledTimes(1);
  });

  it("sends operator notification before exiting", async () => {
    await elegantShutdown();
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Shutting down"),
    );
  });

  it("calls process.exit(0)", async () => {
    await elegantShutdown();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("calls dump hook when registered", async () => {
    const dumpFn = vi.fn((): Promise<void> => Promise.resolve());
    setShutdownDumpHook(dumpFn);
    await elegantShutdown();
    expect(dumpFn).toHaveBeenCalledTimes(1);
  });

  it("swallows dump hook errors", async () => {
    setShutdownDumpHook(() => Promise.reject(new Error("dump failed")));
    await expect(elegantShutdown()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("works with no active sessions", async () => {
    mocks.listSessions.mockReturnValue([]);
    await elegantShutdown();
    expect(mocks.waitForPollerExit).not.toHaveBeenCalled();
    expect(mocks.drainPendingUpdates).not.toHaveBeenCalled();
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    expect(mocks.notifySessionWaiters).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("flushes local logs before shutdown completes", async () => {
    await elegantShutdown();
    expect(mocks.flushCurrentLog).toHaveBeenCalledTimes(1);
  });

  it("rolls local log when session-log mode is disabled", async () => {
    mocks.getSessionLogMode.mockReturnValue(null);
    mocks.rollLog.mockReturnValue("2026-04-15T010203.json");
    await elegantShutdown();
    expect(mocks.rollLog).toHaveBeenCalledTimes(1);
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("Log file created"),
    );
  });

  it("does not roll local log when session-log mode is enabled", async () => {
    mocks.getSessionLogMode.mockReturnValue("manual");
    await elegantShutdown();
    expect(mocks.rollLog).not.toHaveBeenCalled();
  });

  it("does not announce a rolled file when no active log exists", async () => {
    mocks.getSessionLogMode.mockReturnValue(null);
    mocks.rollLog.mockReturnValue(null);
    await elegantShutdown();
    const serviceMessageCalls = mocks.sendServiceMessage.mock.calls as Array<unknown[]>;
    const logAnnouncement = serviceMessageCalls.some((call) => {
      const firstArg = call.at(0);
      return typeof firstArg === "string" && firstArg.includes("Log file created");
    });
    expect(logAnnouncement).toBe(false);
  });

  it("unpins announcement messages for all sessions on shutdown", async () => {
    mocks.listSessions.mockReturnValueOnce([
      { sid: 1, name: "Overseer" },
      { sid: 2, name: "Worker" },
    ]);
    mocks.getSessionAnnouncementMessage.mockImplementation((sid: number) =>
      sid === 1 ? 1001 : 2002,
    );
    await elegantShutdown();
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(123, 1001);
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(123, 2002);
  });

  it("skips unpin when session has no announcement message", async () => {
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Worker" }]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(undefined);
    await elegantShutdown();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when chat is unconfigured", async () => {
    mocks.resolveChat.mockReturnValue("not configured");
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Worker" }]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(999);
    await elegantShutdown();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("continues shutdown even if unpin fails", async () => {
    mocks.listSessions.mockReturnValueOnce([{ sid: 1, name: "Worker" }]);
    mocks.getSessionAnnouncementMessage.mockReturnValue(888);
    mocks.unpinChatMessage.mockRejectedValue(new Error("unpin failed"));
    await expect(elegantShutdown()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("sends pre-shutdown announcement before poller stops", async () => {
    // stopPoller is called after announcement — verify announcement fires
    mocks.listSessions.mockReturnValue([]);
    await elegantShutdown("operator");
    const calls = mocks.sendServiceMessage.mock.calls as Array<[string]>;
    const announcement = calls.find(([text]) => text.includes("Bridge shutting down"));
    expect(announcement).toBeDefined();
    expect(announcement![0]).toContain("operator /shutdown");
  });

  it("sends gravestone after all sessions closed", async () => {
    mocks.listSessions.mockReturnValue([]);
    await elegantShutdown();
    const calls = mocks.sendServiceMessage.mock.calls as Array<[string]>;
    const gravestone = calls.find(([text]) => text.includes("Bridge offline"));
    expect(gravestone).toBeDefined();
  });

  it("continues shutdown if pre-shutdown announcement fails", async () => {
    mocks.listSessions.mockReturnValue([]);
    // First sendServiceMessage call is the announcement — make it fail
    mocks.sendServiceMessage.mockRejectedValueOnce(new Error("Telegram unreachable"));
    await expect(elegantShutdown()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("continues shutdown if gravestone fails", async () => {
    mocks.listSessions.mockReturnValue([]);
    // The gravestone is sent after the announcement and before "Shutting down…"
    // Make all sendServiceMessage calls fail
    mocks.sendServiceMessage.mockRejectedValue(new Error("Telegram unreachable"));
    await expect(elegantShutdown()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// ---------------------------------------------------------------------------
// Regression test — AC5: 4 chat-visible messages in order for 2 fake sessions
// ---------------------------------------------------------------------------

describe("elegantShutdown — chat announcement sequence (AC5)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyCommands.mockResolvedValue(true);
    mocks.resolveChat.mockReturnValue(123);
    mocks.getSessionLogMode.mockReturnValue(null);
    mocks.isLoggingEnabled.mockReturnValue(false);  // skip log-roll noise
    mocks.rollLog.mockReturnValue(null);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("emits announcement → session-1-closed → session-2-closed → gravestone in order", async () => {
    const session1 = { sid: 1, name: "Overseer" };
    const session2 = { sid: 2, name: "Worker" };

    // call 1: snapshot → [s1, s2]
    // call 2: wait-loop while-check → [] (exit loop immediately — sessions self-closed)
    // call 3: force-close listSessions() → [] (nothing left to force-close)
    // Per-session closed lines come from the gracefully-closed set (snapshot minus remaining).
    mocks.listSessions
      .mockReturnValueOnce([session1, session2])  // snapshot
      .mockReturnValueOnce([])                     // wait-loop exits immediately (all self-closed)
      .mockReturnValueOnce([]);                    // force-close query: nothing remaining

    await elegantShutdown("operator");

    // Collect only the chat-visible sendServiceMessage calls (not the "⛔️ Shutting down…" one)
    const chatCalls = (mocks.sendServiceMessage.mock.calls as Array<[string]>).map(([t]) => t);

    // The 4 expected chat-visible messages (in order):
    // 1. Pre-shutdown announcement
    // 2. Session 1 closed line
    // 3. Session 2 closed line
    // 4. Gravestone
    // (The "⛔️ Shutting down…" call also exists but is separate and order-preserved after gravestone)

    const announcementIdx = chatCalls.findIndex((t) => t.includes("Bridge shutting down"));
    const session1Idx     = chatCalls.findIndex((t) => t.includes("Overseer") && t.includes("SID 1"));
    const session2Idx     = chatCalls.findIndex((t) => t.includes("Worker") && t.includes("SID 2"));
    const gravestoneIdx   = chatCalls.findIndex((t) => t.includes("Bridge offline"));

    expect(announcementIdx).toBeGreaterThanOrEqual(0);
    expect(session1Idx).toBeGreaterThanOrEqual(0);
    expect(session2Idx).toBeGreaterThanOrEqual(0);
    expect(gravestoneIdx).toBeGreaterThanOrEqual(0);

    // Order: announcement < session1 < session2 < gravestone
    expect(announcementIdx).toBeLessThan(session1Idx);
    expect(session1Idx).toBeLessThan(session2Idx);
    expect(session2Idx).toBeLessThan(gravestoneIdx);

    // Announcement content: operator cause, session count, restart hint
    const announcementText = chatCalls[announcementIdx];
    expect(announcementText).toContain("operator /shutdown");
    expect(announcementText).toContain("closing 2 active sessions");
    expect(announcementText).toContain("pnpm start");

    // Process exits cleanly
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
