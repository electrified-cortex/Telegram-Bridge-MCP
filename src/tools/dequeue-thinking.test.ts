/**
 * Dequeue → Thinking trigger integration tests.
 *
 * Verifies that the auto-Thinking indicator fires (or does NOT fire) based
 * on the content type of the dequeue batch:
 *   - AC: Actionable operator content (text/voice/command/photo/…) → fires
 *   - AC: Service-message-only batch → does NOT fire
 *   - AC: Empty / timed-out dequeue → does NOT fire
 *   - AC: Reminder events → does NOT fire
 *
 * Harness-agnostic: SIM payloads ASCII-only, no real Telegram IDs.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TimelineEvent } from "../message-store.js";

// ---------------------------------------------------------------------------
// Mock: thinking-state — capture onActionableDequeue calls
// ---------------------------------------------------------------------------

const thinkingMocks = vi.hoisted(() => ({
  onActionableDequeue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../thinking-state.js", () => ({
  onActionableDequeue: (sid: number) => thinkingMocks.onActionableDequeue(sid),
  cancelThinkingForSid: vi.fn(),
  isThinkingActive: vi.fn(() => false),
  extendThinking: vi.fn(),
  closeThinking: vi.fn(),
  removeThinkingState: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: activity/file-state
// ---------------------------------------------------------------------------

const fileStateMocks = vi.hoisted(() => ({
  setDequeueActive: vi.fn(),
  releaseNotifyDebounce: vi.fn(),
  isSseMonitorActive: vi.fn((_sid: number): boolean => false),
  isActivityFileActive: vi.fn((_sid: number): boolean => false),
}));

vi.mock("./activity/file-state.js", () => ({
  setDequeueActive: (sid: number, active: boolean) => fileStateMocks.setDequeueActive(sid, active),
  getActivityFile: vi.fn((_sid: number) => ({ filePath: "/mock/activity.txt" })),
  releaseNotifyDebounce: (sid: number) => fileStateMocks.releaseNotifyDebounce(sid),
  notifyIfAllowed: vi.fn(),
  isSseMonitorActive: (sid: number) => fileStateMocks.isSseMonitorActive(sid),
  isActivityFileActive: (sid: number) => fileStateMocks.isActivityFileActive(sid),
}));

// ---------------------------------------------------------------------------
// Mock: telegram
// ---------------------------------------------------------------------------

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    ackVoiceMessage: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock: session-manager
// ---------------------------------------------------------------------------

const sessionMocks = vi.hoisted(() => ({
  dequeueBatch: vi.fn((): TimelineEvent[] => []),
  pendingCount: vi.fn((): number => 0),
  waitForEnqueue: vi.fn((): Promise<void> => new Promise(() => {})), // never resolves
  getSessionQueue: vi.fn((_sid: number): { dequeueBatch(): TimelineEvent[]; pendingCount(): number; waitForEnqueue(): Promise<void> } | undefined => ({
    dequeueBatch: () => sessionMocks.dequeueBatch(),
    pendingCount: () => sessionMocks.pendingCount(),
    waitForEnqueue: () => sessionMocks.waitForEnqueue(),
  })),
  validateSession: vi.fn((_sid: number, _suffix: number) => true),
  getDequeueDefault: vi.fn((_sid: number) => 300),
  setActiveSession: vi.fn(),
  touchSession: vi.fn(),
  setDequeueIdle: vi.fn(),
  getSession: vi.fn((_sid: number) => ({ name: "TestSession" })),
  takeSilenceHint: vi.fn((_sid: number): string | undefined => undefined),
  checkConnectionToken: vi.fn((_sid: number, _token: string | undefined): "absent" => "absent"),
}));

vi.mock("../session-manager.js", () => ({
  setActiveSession: (sid: number) => sessionMocks.setActiveSession(sid),
  touchSession: (sid: number) => sessionMocks.touchSession(sid),
  validateSession: (sid: number, suffix: number) => sessionMocks.validateSession(sid, suffix),
  getDequeueDefault: (sid: number) => sessionMocks.getDequeueDefault(sid),
  setDequeueIdle: (sid: number, idle: boolean) => sessionMocks.setDequeueIdle(sid, idle),
  getSession: (sid: number) => sessionMocks.getSession(sid),
  takeSilenceHint: (sid: number) => sessionMocks.takeSilenceHint(sid),
  checkConnectionToken: (sid: number, token: string | undefined) => sessionMocks.checkConnectionToken(sid, token),
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => sessionMocks.getSessionQueue(sid),
  getMessageOwner: vi.fn((_msgId: number) => 0),
  peekSessionCategories: vi.fn((_sid: number) => undefined),
  deliverServiceMessage: vi.fn(),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: vi.fn(() => 0),
}));

vi.mock("../message-store.js", () => ({
  dequeueBatch: vi.fn((): TimelineEvent[] => []),
  pendingCount: vi.fn((): number => 0),
  waitForEnqueue: vi.fn((): Promise<void> => new Promise(() => {})),
}));

vi.mock("../service-messages.js", () => ({
  SERVICE_MESSAGES: {
    DUPLICATE_SESSION_DETECTED: { eventType: "dup", text: () => "dup" },
    BEHAVIOR_NUDGE_DEQUEUE_PATTERN: { eventType: "nudge", text: "nudge" },
    BEHAVIOR_NUDGE_MAX_WAIT_ZERO_WITH_SUBSCRIPTION: { eventType: "nudge2", text: "nudge2" },
  },
}));

vi.mock("../reminder-state.js", () => ({
  promoteDeferred: vi.fn(),
  getSoonestDeferredMs: vi.fn(() => null),
  getSoonestScheduleFireMs: vi.fn(() => null),
}));

vi.mock("../animation-state.js", () => ({
  getAnimationStatus: vi.fn(() => ({ active: false })),
}));

vi.mock("../channel.js", () => ({
  resetChannelCooldown: vi.fn(),
  flushPendingChannelNotify: vi.fn(),
}));

vi.mock("../trace-log.js", () => ({
  recordNonToolEvent: vi.fn(),
  recordToolCall: vi.fn(),
}));

vi.mock("../debug-log.js", () => ({
  dlog: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module under test — AFTER all mocks
// ---------------------------------------------------------------------------

import { runDrainLoop } from "./dequeue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SID = 99;

/** Make a TimelineEvent from the user (operator content). */
function makeUserMsg(id: number, type: "text" | "voice" | "command" | "photo" | "doc" | "sticker"): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type, text: "msg" },
    _update: { update_id: id },
  };
}

/** Make a service message (from system). */
function makeServiceMsg(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "service_message",
    from: "system",
    content: { type: "service", text: "info", event_type: "test_event" },
    _update: { update_id: id },
  };
}

/** Make a reminder event. */
function makeReminder(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "reminder",
    from: "system",
    content: { type: "reminder", text: "do thing" },
    _update: { update_id: id },
  };
}

/** Make a user message with type "unknown" (catch-all actionable trigger type). */
function makeUnknownMsg(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "unknown", text: "msg" },
    _update: { update_id: id },
  };
}

function makeAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Flush all pending microtasks (Promise callbacks). */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("dequeue → thinking trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionMocks.pendingCount.mockReturnValue(0);
    sessionMocks.validateSession.mockReturnValue(true);
    sessionMocks.getDequeueDefault.mockReturnValue(300);
    sessionMocks.getSession.mockReturnValue({ name: "TestSession" });
    sessionMocks.getSessionQueue.mockImplementation((_sid: number) => ({
      dequeueBatch: () => sessionMocks.dequeueBatch(),
      pendingCount: () => sessionMocks.pendingCount(),
      waitForEnqueue: () => sessionMocks.waitForEnqueue(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC: Actionable operator content fires thinking ──────────────────────

  it("fires onActionableDequeue for a text message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "text")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a voice message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "voice")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a command message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "command")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a photo message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "photo")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a doc message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "doc")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a sticker message from user", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUserMsg(1, "sticker")]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue for a user message with type unknown", async () => {
    // "unknown" is the catch-all for unrecognised content types and must
    // be treated as actionable so the Thinking indicator fires.
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeUnknownMsg(1)]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  it("fires onActionableDequeue when batch has mixed service + user content", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([
      makeServiceMsg(1),
      makeUserMsg(2, "text"),
    ]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).toHaveBeenCalledWith(SID);
  });

  // ── AC: Non-actionable batches do NOT fire thinking ─────────────────────

  it("does NOT fire onActionableDequeue for service-message-only batch", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeServiceMsg(1)]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).not.toHaveBeenCalled();
  });

  it("does NOT fire onActionableDequeue for reminder-only batch", async () => {
    sessionMocks.dequeueBatch.mockReturnValueOnce([makeReminder(1)]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).not.toHaveBeenCalled();
  });

  it("does NOT fire onActionableDequeue on empty/timeout dequeue (max_wait 0)", async () => {
    sessionMocks.dequeueBatch.mockReturnValue([]);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).not.toHaveBeenCalled();
  });

  it("does NOT fire onActionableDequeue when session queue is gone", async () => {
    sessionMocks.getSessionQueue.mockReturnValue(undefined);
    await runDrainLoop(SID, 0, makeAbortSignal());
    await flushMicrotasks();
    expect(thinkingMocks.onActionableDequeue).not.toHaveBeenCalled();
  });
});
