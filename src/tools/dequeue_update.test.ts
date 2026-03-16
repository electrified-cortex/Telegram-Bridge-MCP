import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

const mocks = vi.hoisted(() => ({
  dequeueBatch: vi.fn((): TimelineEvent[] => []),
  pendingCount: vi.fn(),
  waitForEnqueue: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual };
});

vi.mock("../message-store.js", () => ({
  dequeueBatch: mocks.dequeueBatch,
  pendingCount: mocks.pendingCount,
  waitForEnqueue: mocks.waitForEnqueue,
}));

import { register } from "./dequeue_update.js";

function makeEvent(id: number, text: string, event = "message" as string): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event,
    from: "user",
    content: { type: "text", text },
    _update: { update_id: id } as never,
  };
}

function makeReaction(id: number, target: number): TimelineEvent {
  return {
    id: target,
    timestamp: new Date().toISOString(),
    event: "reaction",
    from: "user",
    content: { type: "reaction", target, added: ["👍"], removed: [] },
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

  it("returns batch of events when available", async () => {
    const evt = makeEvent(1, "Hello");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    const result = await call({ timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].id).toBe(1);
    expect(data.updates[0].event).toBe("message");
    expect(data.updates[0].from).toBe("user");
  });

  it("strips _update and timestamp from compact output", async () => {
    const evt = makeEvent(2, "Hi");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.updates[0]._update).toBeUndefined();
    expect(data.updates[0].timestamp).toBeUndefined();
  });

  it("includes pending count when more events are queued", async () => {
    const evt = makeEvent(3, "A");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    mocks.pendingCount.mockReturnValue(2);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.pending).toBe(2);
  });

  it("does not include pending field when count is 0", async () => {
    const evt = makeEvent(4, "B");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.pending).toBeUndefined();
  });

  it("returns empty when queue is empty and timeout is 0", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    const result = await call({ timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(0);
  });

  it("blocks and returns batch after waitForEnqueue resolves", async () => {
    const evt = makeEvent(5, "Delayed");
    // First call returns nothing, second call returns event
    mocks.dequeueBatch.mockReturnValueOnce([]).mockReturnValueOnce([evt]);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const result = await call({ timeout: 1 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].id).toBe(5);
    expect(data.updates[0].event).toBe("message");
  });

  it("returns empty after timeout expires with no events", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
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
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    await call({ timeout: 1 });
    expect(mocks.waitForEnqueue).toHaveBeenCalled();
  });

  it("does not call waitForEnqueue when timeout is 0", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    await call({ timeout: 0 });
    expect(mocks.waitForEnqueue).not.toHaveBeenCalled();
  });

  it("reports real pendingCount on timeout, not hardcoded 0 (#7)", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.pendingCount.mockReturnValue(3);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await call({ timeout: 1 });
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(3);
  });

  it("reports pending 0 on instant poll when queue is truly empty (#7)", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.empty).toBe(true);
    expect(data.pending).toBe(0);
  });

  // =========================================================================
  // Batch behavior — multiple events in one response
  // =========================================================================

  it("returns reactions and message in a single batch", async () => {
    const reaction = makeReaction(10, 5);
    const message = makeEvent(11, "Hello after reaction");
    mocks.dequeueBatch.mockReturnValueOnce([reaction, message]);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.updates).toHaveLength(2);
    expect(data.updates[0].event).toBe("reaction");
    expect(data.updates[1].event).toBe("message");
    expect(data.updates[1].content.text).toBe("Hello after reaction");
  });

  it("returns only non-content events when no message is queued", async () => {
    const r1 = makeReaction(10, 5);
    const r2 = makeReaction(11, 6);
    mocks.dequeueBatch.mockReturnValueOnce([r1, r2]);
    const result = await call({ timeout: 0 });
    const data = parseResult(result);
    expect(data.updates).toHaveLength(2);
    expect(data.updates[0].event).toBe("reaction");
    expect(data.updates[1].event).toBe("reaction");
  });
});
