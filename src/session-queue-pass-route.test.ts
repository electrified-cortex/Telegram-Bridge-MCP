import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TimelineEvent } from "./message-store.js";
import {
  createSessionQueue,
  getSessionQueue,
  passMessage,
  routeMessage,
  resetSessionQueuesForTest,
} from "./session-queue.js";
import { resetRoutingModeForTest } from "./routing-mode.js";

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

describe("passMessage", () => {
  beforeEach(() => {
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    mockGetMessage.mockReset();
  });

  it("forwards to the next session in SID order", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    createSessionQueue(3);

    const event = makeEvent(100);
    mockGetMessage.mockReturnValue(event);

    const target = passMessage(1, 100);
    expect(target).toBe(2);

    const q2 = getSessionQueue(2);
    const batch = q2?.dequeueBatch() ?? [];
    expect(batch).toHaveLength(1);
    expect(batch[0].id).toBe(100);
  });

  it("skips to third session when passing from second", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    createSessionQueue(3);

    const event = makeEvent(100);
    mockGetMessage.mockReturnValue(event);

    const target = passMessage(2, 100);
    expect(target).toBe(3);
  });

  it("returns 0 when passing from the last session", () => {
    createSessionQueue(1);
    createSessionQueue(2);

    const event = makeEvent(100);
    mockGetMessage.mockReturnValue(event);

    const target = passMessage(2, 100);
    expect(target).toBe(0);
  });

  it("returns 0 when message is not found in store", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    mockGetMessage.mockReturnValue(undefined);

    const target = passMessage(1, 999);
    expect(target).toBe(0);
  });

  it("returns 0 when fromSid has no queue", () => {
    createSessionQueue(2);
    mockGetMessage.mockReturnValue(makeEvent(100));

    const target = passMessage(99, 100);
    expect(target).toBe(0);
  });

  it("does not enqueue to the passing session", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    mockGetMessage.mockReturnValue(makeEvent(100));

    passMessage(1, 100);

    const q1 = getSessionQueue(1);
    expect(q1?.dequeueBatch()).toHaveLength(0);
  });
});

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

    const result = routeMessage(100, 2);
    expect(result).toBe(true);

    const q2 = getSessionQueue(2);
    const batch = q2?.dequeueBatch() ?? [];
    expect(batch).toHaveLength(1);
    expect(batch[0].id).toBe(100);
  });

  it("returns false when message is not found", () => {
    createSessionQueue(1);
    mockGetMessage.mockReturnValue(undefined);

    expect(routeMessage(999, 1)).toBe(false);
  });

  it("returns false when target queue does not exist", () => {
    mockGetMessage.mockReturnValue(makeEvent(100));

    expect(routeMessage(100, 99)).toBe(false);
  });

  it("does not enqueue to other sessions", () => {
    createSessionQueue(1);
    createSessionQueue(2);
    mockGetMessage.mockReturnValue(makeEvent(100));

    routeMessage(100, 2);

    const q1 = getSessionQueue(1);
    expect(q1?.dequeueBatch()).toHaveLength(0);
  });
});
