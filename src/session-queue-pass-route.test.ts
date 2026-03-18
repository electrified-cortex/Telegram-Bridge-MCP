import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TimelineEvent } from "./message-store.js";
import {
  createSessionQueue,
  getSessionQueue,
  routeMessage,
  resetSessionQueuesForTest,
} from "./session-queue.js";

// ---------------------------------------------------------------------------
// Mock getMessage from message-store
// ---------------------------------------------------------------------------

const mockGetMessage = vi.fn<() => TimelineEvent | undefined>();

vi.mock("./message-store.js", () => ({
  getMessage: (...args: unknown[]) => mockGetMessage(...args as []),
  CURRENT: -1,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(id: number, text = "hello"): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routeMessage", () => {
  beforeEach(() => {
    resetSessionQueuesForTest();
    mockGetMessage.mockReset();
  });

  it("delivers to the target session queue", () => {
    createSessionQueue(1);
    createSessionQueue(2);

    const event = makeEvent(100);
    mockGetMessage.mockReturnValue(event);

    const result = routeMessage(100, 2, 1);
    expect(result).toBe(true);

    const q2 = getSessionQueue(2);
    const batch = q2?.dequeueBatch() ?? [];
    expect(batch).toHaveLength(1);
    expect(batch[0].id).toBe(100);
  });

  it("injects routed_by field with router SID", () => {
    createSessionQueue(1);
    createSessionQueue(2);

    const event = makeEvent(100);
    mockGetMessage.mockReturnValue(event);
    routeMessage(100, 2, 1);

    const q2 = getSessionQueue(2);
    const batch = q2?.dequeueBatch() ?? [];
    expect(batch[0].content.routed_by).toBe(1);
    // Original event is not mutated
    expect(event.content.routed_by).toBeUndefined();
  });

  it("returns false when message is not found", () => {
    createSessionQueue(1);
    mockGetMessage.mockReturnValue(undefined);

    expect(routeMessage(999, 1, 1)).toBe(false);
  });

  it("returns false when target queue does not exist", () => {
    mockGetMessage.mockReturnValue(makeEvent(100));

    expect(routeMessage(100, 99, 1)).toBe(false);
  });

  it("does not enqueue to other sessions", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    mockGetMessage.mockReturnValue(makeEvent(100));

    routeMessage(100, 2, 1);

    const q1 = getSessionQueue(1);
    expect(q1?.dequeueBatch()).toHaveLength(0);
  });
});
