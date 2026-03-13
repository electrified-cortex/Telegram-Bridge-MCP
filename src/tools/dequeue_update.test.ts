import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

const mocks = vi.hoisted(() => ({
  dequeue: vi.fn(),
  pendingCount: vi.fn(),
  waitForEnqueue: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual };
});

vi.mock("../message-store.js", () => ({
  dequeue: mocks.dequeue,
  pendingCount: mocks.pendingCount,
  waitForEnqueue: mocks.waitForEnqueue,
}));

import { register } from "./dequeue_update.js";

function makeEvent(id: number, text: string): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text },
    _update: { update_id: id } as never,
  };
}

describe("dequeue_update tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("dequeue_update");
  });

  it("returns event immediately when available", async () => {
    const event = makeEvent(1, "Hello");
    mocks.dequeue.mockReturnValueOnce(event);
    const result = await call({ timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.id).toBe(1);
    expect(data.event).toBe("message");
    expect(data.from).toBe("user");
  });

  it("strips _update and timestamp from compact output", async () => {
    const event = makeEvent(2, "Hi");
    mocks.dequeue.mockReturnValueOnce(event);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data._update).toBeUndefined();
    expect(data.timestamp).toBeUndefined();
  });

  it("includes pending count when more events are queued", async () => {
    const event = makeEvent(3, "A");
    mocks.dequeue.mockReturnValueOnce(event);
    mocks.pendingCount.mockReturnValue(2);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.pending).toBe(2);
  });

  it("does not include pending field when count is 0", async () => {
    const event = makeEvent(4, "B");
    mocks.dequeue.mockReturnValueOnce(event);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.pending).toBeUndefined();
  });

  it("returns empty when queue is empty and timeout is 0", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    const result = await call({ timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(0);
  });

  it("blocks and returns event after waitForEnqueue resolves", async () => {
    const event = makeEvent(5, "Delayed");
    // First call returns nothing, second call returns event
    mocks.dequeue.mockReturnValueOnce(undefined).mockReturnValueOnce(event);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const result = await call({ timeout: 1 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.id).toBe(5);
    expect(data.event).toBe("message");
  });

  it("returns empty after timeout expires with no events", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    // waitForEnqueue resolves but dequeue still returns nothing
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await call({ timeout: 1 });
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(0);
  });

  it("calls waitForEnqueue when queue is empty and timeout > 0", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    await call({ timeout: 1 });
    expect(mocks.waitForEnqueue).toHaveBeenCalled();
  });

  it("does not call waitForEnqueue when timeout is 0", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    await call({ timeout: 0 });
    expect(mocks.waitForEnqueue).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Issue #7 — timeout path should report real pendingCount, not hardcoded 0
  // =========================================================================

  it("reports real pendingCount on timeout, not hardcoded 0 (#7)", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    // Items arrive just before timeout but aren't dequeued (race)
    mocks.pendingCount.mockReturnValue(3);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await call({ timeout: 1 });
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    // Should reflect actual queue state, not hardcoded 0
    expect(data.pending).toBe(3);
  });

  it("reports pending 0 on instant poll when queue is truly empty (#7)", async () => {
    mocks.dequeue.mockReturnValue(undefined);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(0);
  });
});
