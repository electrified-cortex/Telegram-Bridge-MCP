import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  elegantShutdown: vi.fn((): Promise<never> => new Promise(() => {})),
  pendingCount: vi.fn((): number => 0),
  listSessions: vi.fn(() => [] as Array<{ sid: number }>),
  getSessionQueue: vi.fn((_sid: number) => undefined as { pendingCount(): number } | undefined),
}));

vi.mock("../shutdown.js", () => ({
  elegantShutdown: mocks.elegantShutdown,
}));

vi.mock("../message-store.js", () => ({
  pendingCount: mocks.pendingCount,
}));

vi.mock("../session-manager.js", () => ({
  listSessions: mocks.listSessions,
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: mocks.getSessionQueue,
}));

import { register } from "./shutdown.js";

describe("shutdown tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.getSessionQueue.mockReturnValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("shutdown");
  });

  it("triggers elegantShutdown when queue is empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    // elegantShutdown is called via setImmediate — run pending microtasks
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("returns warning (not error) when global queue has items and force is not set", async () => {
    mocks.pendingCount.mockReturnValue(3);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.shutting_down).toBe(false);
    expect(data.warning).toBe("PENDING_MESSAGES");
    expect(data.pending).toBe(3);
    expect(data.message).toContain("3 pending");
    expect(mocks.elegantShutdown).not.toHaveBeenCalled();
  });

  it("includes session queue pending counts in the total", async () => {
    mocks.pendingCount.mockReturnValue(1); // 1 in global queue
    mocks.listSessions.mockReturnValue([
      { sid: 1 },
      { sid: 2 },
    ]);
    mocks.getSessionQueue
      .mockReturnValueOnce({ pendingCount: () => 2 }) // sid 1: 2 pending
      .mockReturnValueOnce({ pendingCount: () => 1 }); // sid 2: 1 pending
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.shutting_down).toBe(false);
    expect(data.pending).toBe(4); // 1 global + 2 + 1 session
    expect(data.warning).toBe("PENDING_MESSAGES");
    expect(mocks.elegantShutdown).not.toHaveBeenCalled();
  });

  it("bypasses pending guard when force: true", async () => {
    mocks.pendingCount.mockReturnValue(5);
    const result = parseResult(await call({ force: true }));
    expect(result.shutting_down).toBe(true);
    expect(result.pending_flushed).toBe(5);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("force: true with session queue pending still shuts down and reports total", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.listSessions.mockReturnValue([{ sid: 1 }]);
    mocks.getSessionQueue.mockReturnValueOnce({ pendingCount: () => 3 });
    const result = parseResult(await call({ force: true }));
    expect(result.shutting_down).toBe(true);
    expect(result.pending_flushed).toBe(5); // 2 global + 3 session
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("includes pending_flushed: 0 in result when queue is empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.pending_flushed).toBe(0);
    await new Promise<void>((r) => setImmediate(r));
  });

  it("proceeds normally when session queues exist but all are empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    mocks.listSessions.mockReturnValue([{ sid: 1 }, { sid: 2 }]);
    mocks.getSessionQueue
      .mockReturnValueOnce({ pendingCount: () => 0 })
      .mockReturnValueOnce({ pendingCount: () => 0 });
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });
});
