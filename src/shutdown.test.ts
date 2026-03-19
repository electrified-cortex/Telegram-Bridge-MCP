import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setMyCommands: vi.fn(),
  resolveChat: vi.fn((): number | string => 123),
  sendServiceMessage: vi.fn((): Promise<void> => Promise.resolve()),
  stopPoller: vi.fn(),
  waitForPollerExit: vi.fn((): Promise<void> => Promise.resolve()),
  drainPendingUpdates: vi.fn((): Promise<void> => Promise.resolve()),
  listSessions: vi.fn((): Array<{ sid: number; name: string }> => []),
  deliverServiceMessage: vi.fn((): boolean => true),
  notifySessionWaiters: vi.fn(),
}));

vi.mock("./telegram.js", () => ({
  getApi: () => ({ setMyCommands: mocks.setMyCommands }),
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
}));

vi.mock("./session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
  notifySessionWaiters: mocks.notifySessionWaiters,
}));

import { clearCommandsOnShutdown, elegantShutdown, setShutdownDumpHook } from "./shutdown.js";

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

describe("elegantShutdown", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyCommands.mockResolvedValue(true);
    // Prevent process.exit from actually killing the test runner
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("stops poller, waits for exit, and drains pending updates", async () => {
    await elegantShutdown();
    expect(mocks.stopPoller).toHaveBeenCalledTimes(1);
    expect(mocks.waitForPollerExit).toHaveBeenCalledTimes(1);
    expect(mocks.drainPendingUpdates).toHaveBeenCalledTimes(1);
  });

  it("delivers shutdown service message to all active sessions", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Overseer" },
      { sid: 2, name: "Worker" },
    ]);

    await elegantShutdown();

    expect(mocks.deliverServiceMessage).toHaveBeenCalledTimes(2);
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("shutting down"),
      "shutdown",
    );
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      2,
      expect.stringContaining("shutting down"),
      "shutdown",
    );
  });

  it("notifies session waiters after delivering shutdown messages", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "A" }]);
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
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    expect(mocks.notifySessionWaiters).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
