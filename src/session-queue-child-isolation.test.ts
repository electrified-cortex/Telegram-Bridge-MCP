/**
 * Tests for child-session SSE isolation (10-3057, TG 80273).
 *
 * When a child session calls child/notify (triggering `deliverChildNotifyEvent`),
 * the parent's SSE stream must NOT fire `data: notify` and the parent's channel
 * subscriber must NOT receive a wake signal. The event is still enqueued to the
 * parent's queue so the parent can read it on its next natural dequeue.
 *
 * Acceptance criteria covered:
 *   AC1  — child/notify does NOT fire parent SSE
 *   AC2  — parent SSE fires ONLY for messages targeted at parent's own SID
 *   AC5  — parent's own targeted messages still arrive promptly
 *   AC6  — child's own SSE still fires for child-targeted messages
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TimelineEvent } from "./message-store.js";
import {
  createSessionQueue,
  getSessionQueue,
  routeToSession,
  trackMessageOwner,
  deliverChildNotifyEvent,
  resetSessionQueuesForTest,
} from "./session-queue.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const notifySseSubscriberMock = vi.hoisted(() => vi.fn<(sid: number) => void>());
const notifyIfAllowedMock = vi.hoisted(() => vi.fn<() => boolean>().mockReturnValue(true));
const isDequeueActiveMock = vi.hoisted(() => vi.fn<() => boolean>().mockReturnValue(false));
const notifyChannelSubscriberMock = vi.hoisted(() => vi.fn<(sid: number) => void>());

vi.mock("./sse-endpoint.js", () => ({
  notifySseSubscriber: notifySseSubscriberMock,
}));

vi.mock("./tools/activity/file-state.js", () => ({
  notifyIfAllowed: notifyIfAllowedMock,
  isDequeueActive: isDequeueActiveMock,
  setActivityFile: vi.fn(),
  getActivityFile: vi.fn(),
}));

vi.mock("./channel.js", () => ({
  notifyChannelSubscriber: notifyChannelSubscriberMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARENT_SID = 10;
const CHILD_SID = 20;

function textEvent(id: number, replyTo?: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text: "hello", ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("child SSE isolation (10-3057)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionQueuesForTest();
    notifyIfAllowedMock.mockReturnValue(true);
    isDequeueActiveMock.mockReturnValue(false);
  });

  // ── AC1: deliverChildNotifyEvent does NOT wake parent SSE or channel ───────

  it("AC1: deliverChildNotifyEvent does NOT call notifySseSubscriber for parent", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);

    deliverChildNotifyEvent(PARENT_SID, CHILD_SID, "thread/routed", { thread_sid: 5 });

    expect(notifySseSubscriberMock).not.toHaveBeenCalledWith(PARENT_SID);
  });

  it("AC1: deliverChildNotifyEvent does NOT call notifyChannelSubscriber for parent", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);

    deliverChildNotifyEvent(PARENT_SID, CHILD_SID, "thread/routed");

    expect(notifyChannelSubscriberMock).not.toHaveBeenCalledWith(PARENT_SID);
  });

  it("AC1: deliverChildNotifyEvent fires NO notify at all (total SSE call count is 0)", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);

    deliverChildNotifyEvent(PARENT_SID, CHILD_SID, "thread/resolved");

    expect(notifySseSubscriberMock).not.toHaveBeenCalled();
    expect(notifyChannelSubscriberMock).not.toHaveBeenCalled();
  });

  // ── Parent queue still receives the event (readability preserved) ──────────

  it("parent queue still contains the child/notify event (readable on next dequeue)", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);

    const delivered = deliverChildNotifyEvent(PARENT_SID, CHILD_SID, "thread/routed", { x: 1 });

    expect(delivered).toBe(true);
    expect(getSessionQueue(PARENT_SID)?.pendingCount()).toBe(1);
  });

  it("returns false when parent queue does not exist", () => {
    createSessionQueue(CHILD_SID);
    // PARENT_SID has no queue

    const delivered = deliverChildNotifyEvent(PARENT_SID, CHILD_SID, "thread/routed");

    expect(delivered).toBe(false);
    expect(notifySseSubscriberMock).not.toHaveBeenCalled();
  });

  // ── AC6: child's own SSE still fires for child-targeted inbound messages ───

  it("AC6: enqueueToSession (targeted child message) still calls notifySseSubscriber for child", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);
    trackMessageOwner(50, CHILD_SID); // user replies to child's msg → routes to child

    routeToSession(textEvent(1, 50));

    expect(notifySseSubscriberMock).toHaveBeenCalledWith(CHILD_SID);
    expect(notifySseSubscriberMock).not.toHaveBeenCalledWith(PARENT_SID);
  });

  // ── AC5/AC2: parent's own targeted messages still trigger parent SSE ───────

  it("AC5/AC2: parent's own targeted message still calls notifySseSubscriber for parent", () => {
    createSessionQueue(PARENT_SID);
    createSessionQueue(CHILD_SID);
    trackMessageOwner(60, PARENT_SID); // user replies to parent's msg → routes to parent

    routeToSession(textEvent(2, 60));

    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID);
    expect(notifySseSubscriberMock).not.toHaveBeenCalledWith(CHILD_SID);
  });
});
