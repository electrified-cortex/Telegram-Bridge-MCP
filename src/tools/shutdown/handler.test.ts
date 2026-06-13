import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  elegantShutdown: vi.fn((): Promise<never> => new Promise(() => {})),
  pendingCount: vi.fn((): number => 0),
  listSessions: vi.fn(() => [] as Array<{ sid: number }>),
  getSessionQueue: vi.fn((_sid: number) => undefined as { pendingCount(): number } | undefined),
  getGovernorSid: vi.fn((): number => 0),
}));

vi.mock("../../shutdown.js", () => ({
  elegantShutdown: mocks.elegantShutdown,
}));

vi.mock("../../message-store.js", () => ({
  pendingCount: mocks.pendingCount,
}));

vi.mock("../../session-manager.js", () => ({
  listSessions: mocks.listSessions,
}));

vi.mock("../../session-queue.js", () => ({
  getSessionQueue: mocks.getSessionQueue,
}));

vi.mock("../../routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

import { register } from "./handler.js";

describe("shutdown tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.getSessionQueue.mockReturnValue(undefined);
    mocks.getGovernorSid.mockReturnValue(0);
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
    // governor=0, participant sid=1 → participantCount=1 → pending check applies
    mocks.listSessions.mockReturnValue([{ sid: 1 }]);
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
    expect(result.pending_at_shutdown).toBe(5);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("force: true with session queue pending still shuts down and reports total", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.listSessions.mockReturnValue([{ sid: 1 }]);
    mocks.getSessionQueue.mockReturnValueOnce({ pendingCount: () => 3 });
    const result = parseResult(await call({ force: true }));
    expect(result.shutting_down).toBe(true);
    expect(result.pending_at_shutdown).toBe(5); // 2 global + 3 session
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("includes pending_at_shutdown: 0 in result when queue is empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.pending_at_shutdown).toBe(0);
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

  // ── No-participants fast path ──────────────────────────────────────────────

  it("shuts down immediately when governor is the only session (no participants)", async () => {
    // Single-session mode: only the governor session is active.
    mocks.listSessions.mockReturnValue([{ sid: 5 }]);
    mocks.getGovernorSid.mockReturnValue(5);
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("skips pending-message check when governor is the only session", async () => {
    // Even with pending messages, governor-only → immediate shutdown (nobody to drain them).
    mocks.listSessions.mockReturnValue([{ sid: 3 }]);
    mocks.getGovernorSid.mockReturnValue(3);
    mocks.pendingCount.mockReturnValue(7);
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    expect(result.pending_at_shutdown).toBe(7);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("preserves PENDING_MESSAGES warning when non-governor participants are present", async () => {
    // Governor (sid=1) + participant (sid=2) → pending check applies.
    mocks.listSessions.mockReturnValue([{ sid: 1 }, { sid: 2 }]);
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.pendingCount.mockReturnValue(4);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.shutting_down).toBe(false);
    expect(data.warning).toBe("PENDING_MESSAGES");
    expect(data.pending).toBe(4);
    expect(mocks.elegantShutdown).not.toHaveBeenCalled();
  });

  it("shuts down immediately with zero sessions (no-sessions fast path)", async () => {
    // Unchanged behavior: 0 sessions → participantCount === 0 → immediate shutdown.
    mocks.listSessions.mockReturnValue([]);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });
});
