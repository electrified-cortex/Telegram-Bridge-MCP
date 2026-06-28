/**
 * Tests for task 10-3067: parent-notify silent while child active.
 *
 * When a child sub-session is active and dequeuing, the parent session must
 * continue to receive `notify` SSE events for new inbound operator messages.
 * Child-session service messages (CHILD_FIRST_DEQUEUE_CONFIRMED, etc.) arm a
 * debounce window on the parent's notify gate; that window must NOT suppress
 * subsequent operator messages addressed to the parent.
 *
 * Acceptance criteria covered:
 *   AC1 — operator message to parent fires SSE even when service-message debounce is active
 *   AC2 — child activity does NOT touch parent's behavior/presence state
 *   AC3 — regression: service msg debounce → operator SSE fires; parent gate resets correctly
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const notifySseSubscriberMock = vi.hoisted(() => vi.fn<(sid: number) => void>());

/** notifyIfAllowed lives in file-state.ts — we import the REAL implementation. */
const isDequeueActiveMock = vi.hoisted(() => vi.fn<() => boolean>().mockReturnValue(false));
const notifyChannelSubscriberMock = vi.hoisted(() => vi.fn<(sid: number) => void>());

vi.mock("./sse-endpoint.js", () => ({
  notifySseSubscriber: notifySseSubscriberMock,
}));

vi.mock("./tools/activity/file-state.js", async (importOriginal) => {
  // Use the REAL notifyIfAllowed so debounceArmedBySource logic is exercised.
  const real = await importOriginal<typeof import("./tools/activity/file-state.js")>();
  return {
    ...real,
    isDequeueActive: isDequeueActiveMock,
  };
});

vi.mock("./channel.js", () => ({
  notifyChannelSubscriber: notifyChannelSubscriberMock,
}));

// Minimal session-manager stubs required by file-state.ts
vi.mock("./session-manager.js", () => ({
  getNotifyDebounceMs: vi.fn((_sid: number) => 300_000),
  getSession: vi.fn(),
}));

// Minimal session-queue stubs (hasPendingUserContent drives re-eval logic)
vi.mock("./session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number) => false),
  hasPendingReminderContent: vi.fn((_sid: number) => false),
  createSessionQueue: vi.fn(),
  removeSessionQueue: vi.fn(),
  resetSessionQueuesForTest: vi.fn(),
  deliverServiceMessage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  notifyIfAllowed,
  registerSseMonitor,
  resetActivityFileStateForTest,
  initSseNotifyCallback,
  releaseNotifyDebounce,
} from "./tools/activity/file-state.js";

import { notifySession } from "./tools/notify.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARENT_SID = 1;
const CHILD_SID = 6;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("10-3067: parent notify not silenced by child session activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    isDequeueActiveMock.mockReturnValue(false);
    // Wire SSE callback for fireRevaluationNotify re-eval path.
    // Direct notify calls use notifySession → notifySseSubscriber (mocked via sse-endpoint).
    initSseNotifyCallback(notifySseSubscriberMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC1: operator message bypasses service-armed debounce ─────────────────

  it("AC1: operator message fires parent SSE even when service-msg debounce is active", () => {
    registerSseMonitor(PARENT_SID);

    // Simulate CHILD_FIRST_DEQUEUE_CONFIRMED delivered to parent queue
    // (source="service", parent NOT in dequeue → inflightAtEnqueue=false)
    notifySession(PARENT_SID, "service", false); // SSE fires, arms 300s debounce
    notifySseSubscriberMock.mockClear(); // reset after service-msg SSE

    // Operator sends message while service debounce is active
    notifySession(PARENT_SID, "operator", false); // MUST bypass debounce → SSE fires

    // Parent SSE fired for the operator message
    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID);
  });

  it("AC1 (via notifySession): notifySession with source=operator bypasses service debounce", () => {
    registerSseMonitor(PARENT_SID);

    // Service message arms debounce
    notifySession(PARENT_SID, "service", false);
    notifySseSubscriberMock.mockClear();

    // Operator message via notifySession
    notifySession(PARENT_SID, "operator", false);

    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID);
  });

  it("AC1: parent SSE fires for operator msg AFTER debounce was released too", () => {
    registerSseMonitor(PARENT_SID);

    // Service msg → debounce → parent dequeues → debounce released
    notifySession(PARENT_SID, "service", false);
    releaseNotifyDebounce(PARENT_SID, true);
    notifySseSubscriberMock.mockClear();

    // Operator message: fresh gate (debounce=null) → SSE fires
    notifySession(PARENT_SID, "operator", false);

    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID);
  });

  // ── AC2: child activity does NOT affect parent's gate state ───────────────

  it("AC2: child's setDequeueActive (inflightDequeue) does not affect parent gate", () => {
    registerSseMonitor(PARENT_SID);
    registerSseMonitor(CHILD_SID);

    // isDequeueActive is mocked — simulate child in dequeue but NOT parent
    isDequeueActiveMock.mockImplementation((sid?: number) => sid === CHILD_SID);

    // Operator message to parent: should NOT be suppressed by child's dequeue state
    const parentResult = notifyIfAllowed(PARENT_SID, "operator", false);
    expect(parentResult).toBe(true);
  });

  // ── AC3: regression — operator message notifies parent across full round-trip ─

  it("AC3: service debounce → operator SSE → dequeue → clear → service debounce again → operator SSE", () => {
    registerSseMonitor(PARENT_SID);

    // Round 1: child first dequeue → service message to parent → debounce armed
    notifySession(PARENT_SID, "service", false); // CHILD_FIRST_DEQUEUE_CONFIRMED
    notifySseSubscriberMock.mockClear();

    // Operator sends message while service debounce active → bypass (AC1)
    notifySession(PARENT_SID, "operator", false);
    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID); // AC1 bypass
    notifySseSubscriberMock.mockClear();

    // Parent dequeues operator message → release debounce
    releaseNotifyDebounce(PARENT_SID, true);

    // Round 2: child sends another lifecycle service message to parent
    notifySession(PARENT_SID, "service", false); // e.g., CHILD_SESSION_STALE
    notifySseSubscriberMock.mockClear();

    // Another operator message → must bypass again (AC1 still works after re-arm)
    notifySession(PARENT_SID, "operator", false);
    expect(notifySseSubscriberMock).toHaveBeenCalledWith(PARENT_SID); // AC1 bypass
  });

  it("AC3: debounceArmedBySource is cleared after releaseNotifyDebounce", () => {
    registerSseMonitor(PARENT_SID);

    // Service arms debounce
    notifyIfAllowed(PARENT_SID, "service", false);

    // Release (parent dequeued)
    releaseNotifyDebounce(PARENT_SID, true);

    // After release, next operator should fire (debounce null = always fires)
    notifySseSubscriberMock.mockClear();
    const result = notifyIfAllowed(PARENT_SID, "operator", false);
    expect(result).toBe(true);
  });

  // ── Regression guard: operator burst STILL debounces within operator window ─

  it("operator burst still debounces after first operator message (AC1 is source-selective)", () => {
    registerSseMonitor(PARENT_SID);

    // First operator message: allowed (arms operator-debounce)
    expect(notifyIfAllowed(PARENT_SID, "operator", false)).toBe(true);

    // Second operator message: must be debounced (operator-armed window, no bypass)
    expect(notifyIfAllowed(PARENT_SID, "operator", false)).toBe(false);
    expect(notifyIfAllowed(PARENT_SID, "operator", false)).toBe(false);
  });

  it("service message does NOT bypass another service-armed debounce", () => {
    registerSseMonitor(PARENT_SID);

    expect(notifyIfAllowed(PARENT_SID, "service", false)).toBe(true);   // arm
    expect(notifyIfAllowed(PARENT_SID, "service", false)).toBe(false);  // debounced
  });

  // ── CHILD_SID activity does not fire PARENT SSE ───────────────────────────

  it("child's notify gate is separate from parent's gate", () => {
    registerSseMonitor(PARENT_SID);
    registerSseMonitor(CHILD_SID);

    // Arm debounce on parent via service message
    notifySession(PARENT_SID, "service", false);
    notifySseSubscriberMock.mockClear();

    // Child's own operator notify goes through the CHILD's gate (completely separate)
    notifySession(CHILD_SID, "operator", false);

    // Child SSE fires for child, but parent SSE must NOT fire
    expect(notifySseSubscriberMock).toHaveBeenCalledWith(CHILD_SID);
    expect(notifySseSubscriberMock).not.toHaveBeenCalledWith(PARENT_SID);
  });
});
