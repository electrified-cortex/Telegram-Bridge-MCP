import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import { delay } from "../utils/timing.js";
import type { TimelineEvent } from "../message-store.js";

interface CompactEvent {
  id: number;
  event: string;
  from: string;
  content: Record<string, unknown>;
  routing?: string;
  _update?: unknown;
  timestamp?: string;
}

interface DequeueResult {
  updates: CompactEvent[];
  pending?: number;
  timed_out?: boolean;
  hint?: string;
}

interface SessionQueue {
  dequeueBatch: (...args: unknown[]) => TimelineEvent[];
  pendingCount: (...args: unknown[]) => number;
  waitForEnqueue: (...args: unknown[]) => Promise<unknown>;
}

const fileStateMocks = vi.hoisted(() => ({
  setDequeueActive: vi.fn(),
  getActivityFile: vi.fn((_sid: number): { filePath: string } | undefined => ({ filePath: "/mock/activity.txt" })),
  releaseNotifyDebounce: vi.fn((_sid: number) => {}),
  notifyIfAllowed: vi.fn((_sid: number, _source: string, _inflight: boolean) => {}),
  consumeUnexpectedSubscriptionClose: vi.fn((_sid: number): boolean => false),
}));

vi.mock("./activity/file-state.js", () => ({
  setDequeueActive: (sid: number, active: boolean) => fileStateMocks.setDequeueActive(sid, active),
  getActivityFile: (sid: number) => fileStateMocks.getActivityFile(sid),
  releaseNotifyDebounce: (sid: number) => { fileStateMocks.releaseNotifyDebounce(sid); },
  notifyIfAllowed: (sid: number, source: string, inflight: boolean) => { fileStateMocks.notifyIfAllowed(sid, source, inflight); },
  consumeUnexpectedSubscriptionClose: (sid: number) => fileStateMocks.consumeUnexpectedSubscriptionClose(sid),
}));

const mocks = vi.hoisted(() => ({
  dequeueBatch: vi.fn((): TimelineEvent[] => []),
  pendingCount: vi.fn((): number => 0),
  waitForEnqueue: vi.fn((): Promise<void> => Promise.resolve()),
  ackVoiceMessage: vi.fn((_msgId: number) => {}),
  getActiveSession: vi.fn(() => 0),
  setActiveSession: vi.fn((_sid: number) => {}),
  activeSessionCount: vi.fn(() => 0),
  getSessionQueue: vi.fn((_sid: number): SessionQueue | undefined => undefined),
  getMessageOwner: vi.fn((_msgId: number): number => 0),
  peekSessionCategories: vi.fn((_sid: number): Record<string, number> | undefined => undefined),
  touchSession: vi.fn((_sid: number) => {}),
  validateSession: vi.fn((_sid: number, _suffix: number) => true),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _timeout: number) => {}),
  checkConnectionToken: vi.fn((_sid: number, _token: string | undefined): "match" | "mismatch" | "absent" => "absent"),
  deliverServiceMessage: vi.fn((_targetSid: number, ..._args: unknown[]) => true),
  getGovernorSid: vi.fn((): number => 0),
  getSession: vi.fn((_sid: number) => ({ name: "TestSession" }) as { name: string; suppress_pending_hint?: boolean }),
  takeSilenceHint: vi.fn((_sid: number): string | undefined => undefined),
  setDequeueIdle: vi.fn((_sid: number, _idle: boolean) => {}),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    ackVoiceMessage: (msgId: number) => {
      mocks.ackVoiceMessage(msgId);
    },
  };
});

vi.mock("../message-store.js", () => ({
  dequeueBatch: mocks.dequeueBatch,
  pendingCount: mocks.pendingCount,
  waitForEnqueue: mocks.waitForEnqueue,
}));

vi.mock("../session-manager.js", () => ({
  getActiveSession: () => mocks.getActiveSession(),
  setActiveSession: (sid: number) => {
    mocks.setActiveSession(sid);
  },
  activeSessionCount: () => mocks.activeSessionCount(),
  touchSession: (sid: number) => {
    mocks.touchSession(sid);
  },
  validateSession: (sid: number, suffix: number) => {
    return mocks.validateSession(sid, suffix);
  },
  getDequeueDefault: (sid: number) => mocks.getDequeueDefault(sid),
  setDequeueDefault: (sid: number, timeout: number) => {
    mocks.setDequeueDefault(sid, timeout);
  },
  setDequeueIdle: (sid: number, idle: boolean) => { mocks.setDequeueIdle(sid, idle); },
  getSession: (sid: number) => mocks.getSession(sid),
  takeSilenceHint: (sid: number) => mocks.takeSilenceHint(sid),
  checkConnectionToken: (sid: number, token: string | undefined) => mocks.checkConnectionToken(sid, token),
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => mocks.getSessionQueue(sid),
  getMessageOwner: (msgId: number) => mocks.getMessageOwner(msgId),
  peekSessionCategories: (sid: number) => mocks.peekSessionCategories(sid),
  deliverServiceMessage: (targetSid: number, ...args: unknown[]) => mocks.deliverServiceMessage(targetSid, ...args),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../service-messages.js", () => ({
  SERVICE_MESSAGES: {
    DUPLICATE_SESSION_DETECTED: {
      eventType: "duplicate_session_detected",
      text: (sid: number, name: string) => `Duplicate session detected: SID ${sid} Name ${name}`,
    },
    SUBSCRIPTION_CLOSED_UNEXPECTEDLY: {
      eventType: "subscription_closed_unexpectedly",
      text: "Your monitor subscription closed unexpectedly — re-arm your monitor.",
    },
  },
}));

vi.mock("../trace-log.js", () => ({
  recordNonToolEvent: vi.fn(),
  recordToolCall: vi.fn(),
}));

const reminderMocks = vi.hoisted(() => ({
  promoteDeferred: vi.fn((_sid: number) => {}),
  getActiveReminders: vi.fn((_sid: number): unknown[] => []),
  popActiveReminders: vi.fn((_sid: number): unknown[] => []),
  getSoonestDeferredMs: vi.fn((_sid: number): number | null => null),
  popFireableEventReminders: vi.fn((_sid: number): unknown[] => []),
  getSoonestEventReminderMs: vi.fn((_sid: number): number | null => null),
  popFireableScheduleReminders: vi.fn((_sid: number): unknown[] => []),
  getSoonestScheduleFireMs: vi.fn((_sid: number): number | null => null),
  buildReminderEvent: vi.fn((r: unknown) => ({
    id: -1,
    event: "reminder",
    from: "system",
    content: { type: "reminder", text: (r as { text: string }).text, reminder_id: "test-id", recurring: false },
    routing: "ambiguous",
  })),
}));

vi.mock("../reminder-state.js", () => ({
  promoteDeferred: (sid: number) => { reminderMocks.promoteDeferred(sid); },
  getActiveReminders: (sid: number) => reminderMocks.getActiveReminders(sid),
  popActiveReminders: (sid: number) => reminderMocks.popActiveReminders(sid),
  getSoonestDeferredMs: (sid: number) => reminderMocks.getSoonestDeferredMs(sid),
  popFireableEventReminders: (sid: number) => reminderMocks.popFireableEventReminders(sid),
  getSoonestEventReminderMs: (sid: number) => reminderMocks.getSoonestEventReminderMs(sid),
  popFireableScheduleReminders: (sid: number) => reminderMocks.popFireableScheduleReminders(sid),
  getSoonestScheduleFireMs: (sid: number) => reminderMocks.getSoonestScheduleFireMs(sid),
  buildReminderEvent: (r: unknown) => reminderMocks.buildReminderEvent(r),
}));





import { register, _resetTimeoutHintForTest, _resetFirstDequeueHintForTest, _resetActivityFileHintForTest, _resetDequeueRateForTest, _resetDequeueThrottleForTest, notifyDequeueOutboundSend, _setBackoffSleepForTest, _getBackoffDelayForTest } from "./dequeue.js";

function makeEvent(id: number, text: string, event = "message" as string): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event,
    from: "user",
    content: { type: "text", text },
    _update: { update_id: id },
  };
}

function makeReaction(id: number, target: number): TimelineEvent {
  return {
    id: target,
    timestamp: new Date().toISOString(),
    event: "reaction",
    from: "user",
    content: { type: "reaction", target, added: ["👍"], removed: [] },
    _update: { update_id: id },
  };
}

function makeVoiceEvent(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "voice", text: "hello", file_id: "f1", duration: 2 } as never,
    _update: { update_id: id },
  };
}

describe("dequeue tool", () => {
  let call: (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    fileStateMocks.getActivityFile.mockReturnValue({ filePath: "/mock/activity.txt" });
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    // Default: connection token check returns "absent" (caller omitted token)
    mocks.checkConnectionToken.mockReturnValue("absent");
    // Default: no governor set
    mocks.getGovernorSid.mockReturnValue(0);
    // Default session queue for any sid proxies to the global mock fns
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
    const server = createMockServer();
    register(server);
    call = server.getHandler("dequeue");
  });

  it("returns batch of events when available", async () => {
    const evt = makeEvent(1, "Hello");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].id).toBe(1);
    expect(data.updates[0].event).toBe("message");
    expect(data.updates[0].from).toBe("user");
  });

  it("strips _update and timestamp from compact output", async () => {
    const evt = makeEvent(2, "Hi");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates[0]._update).toBeUndefined();
    expect(data.updates[0].timestamp).toBeUndefined();
  });

  it("includes pending count when more events are queued", async () => {
    const evt = makeEvent(3, "A");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    mocks.pendingCount.mockReturnValue(2);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.pending).toBe(2);
  });

  it("does not include pending field when count is 0", async () => {
    const evt = makeEvent(4, "B");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.pending).toBeUndefined();
  });

  it("returns pending on instant poll when queue is empty", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBeUndefined();
    expect(data.pending).toBe(0);
  });

  it("blocks and returns batch after waitForEnqueue resolves", async () => {
    const evt = makeEvent(5, "Delayed");
    // First call returns nothing, second call returns event
    mocks.dequeueBatch.mockReturnValueOnce([]).mockReturnValueOnce([evt]);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const result = await call({ timeout: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].id).toBe(5);
    expect(data.updates[0].event).toBe("message");
  });

  it("returns timed_out after timeout expires with no events", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    // waitForEnqueue resolves but dequeue still returns nothing
    mocks.waitForEnqueue.mockImplementation(
      () => delay(50),
    );
    const result = await call({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
    expect(data.pending).toBeUndefined();
  });

  it("calls waitForEnqueue when queue is empty and timeout > 0", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(
      () => delay(50),
    );
    await call({ timeout: 1, token: 1_123_456 });
    expect(mocks.waitForEnqueue).toHaveBeenCalled();
  });

  it("does not call waitForEnqueue when timeout is 0", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.waitForEnqueue).not.toHaveBeenCalled();
  });

  it("reports real pendingCount on timeout, not hardcoded 0 (#7)", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.pendingCount.mockReturnValue(3);
    mocks.waitForEnqueue.mockImplementation(
      () => delay(50),
    );
    const result = await call({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
    expect(data.pending).toBe(3);
  });

  it("reports pending 0 on instant poll when queue is truly empty (#7)", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.pendingCount.mockReturnValue(0);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBeUndefined();
    expect(data.pending).toBe(0);
  });

  it("uses session manager default (300 s) when timeout is omitted", async () => {
    // Verify the default is NOT 0 (instant): if it were 0, waitForEnqueue would
    // never be called. Instead we should see it called, then receive the event.
    const evt = makeEvent(99, "Default timeout test");
    mocks.dequeueBatch
      .mockReturnValueOnce([])   // empty on first check → triggers block wait
      .mockReturnValueOnce([evt]); // event arrives after enqueue
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const result = await call({ token: 1_123_456 });
    expect(mocks.waitForEnqueue).toHaveBeenCalled();
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toHaveLength(1);
  });

  // =========================================================================
  // Batch behavior — multiple events in one response
  // =========================================================================

  it("returns reactions and message in a single batch", async () => {
    const reaction = makeReaction(10, 5);
    const message = makeEvent(11, "Hello after reaction");
    mocks.dequeueBatch.mockReturnValueOnce([reaction, message]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toHaveLength(2);
    expect(data.updates[0].event).toBe("reaction");
    expect(data.updates[1].event).toBe("message");
    expect(data.updates[1].content.text).toBe("Hello after reaction");
  });

  it("returns only non-content events when no message is queued", async () => {
    const r1 = makeReaction(10, 5);
    const r2 = makeReaction(11, 6);
    mocks.dequeueBatch.mockReturnValueOnce([r1, r2]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toHaveLength(2);
    expect(data.updates[0].event).toBe("reaction");
    expect(data.updates[1].event).toBe("reaction");
  });

  // =========================================================================
  // Voice ack
  // =========================================================================

  it("acks voice messages on dequeue", async () => {
    const evt = makeVoiceEvent(77);
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(77);
  });

  it("does not call ackVoiceMessage for non-voice events", async () => {
    const evt = makeEvent(88, "text message");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).not.toHaveBeenCalled();
  });

  it("acks voice message via session queue path (immediate batch)", async () => {
    // Edge case #3: the ack fires through the session queue dequeueBatch
    // path, not the global dequeueBatch — this path had zero test coverage.
    const evt = makeVoiceEvent(90);
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValueOnce(3);
    mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);

    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(90);
  });

  it("acks multiple voice messages in a batch via session queue", async () => {
    const v1 = makeVoiceEvent(91);
    const v2 = makeVoiceEvent(92);
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [v1, v2] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValueOnce(3);
    mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);

    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(91);
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(92);
  });

  it("acks voice message via session queue path (blocking wait path)", async () => {
    // Edge case #7: blocking wait path + session queue — ack must fire when
    // the event arrives after the initial empty poll.
    const evt = makeVoiceEvent(93);
    const mockSessionQueue = {
      dequeueBatch: vi.fn()
        .mockReturnValueOnce([] as TimelineEvent[])
        .mockReturnValueOnce([evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValue(3);
    mocks.getSessionQueue.mockReturnValue(mockSessionQueue);

    await call({ timeout: 1, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(93);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getSessionQueue.mockReturnValue(undefined);
  });

  it("does not ack non-voice events mixed with voice in session queue batch", async () => {
    const voiceEvt = makeVoiceEvent(94);
    const textEvt = makeEvent(95, "text");
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [textEvt, voiceEvt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValueOnce(3);
    mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);

    await call({ timeout: 0, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledTimes(1);
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(94);
  });

  it("acks voice message on global blocking wait path", async () => {
    // Edge case #7: blocking wait on global queue (single-session) returns
    // a voice event — ack must fire on that path too.
    const evt = makeVoiceEvent(96);
    mocks.dequeueBatch
      .mockReturnValueOnce([])
      .mockReturnValueOnce([evt]);
    mocks.waitForEnqueue.mockResolvedValue(undefined);

    await call({ timeout: 1, token: 1_123_456 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(96);
  });

  // =========================================================================
  // Session queue path
  // =========================================================================

  it("routes through session queue when getActiveSession returns a non-zero SID", async () => {
    const evt = makeEvent(55, "from session queue");
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValueOnce(7);
    mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);

    const result = await call({ timeout: 0, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates[0].id).toBe(55);
    expect(mockSessionQueue.dequeueBatch).toHaveBeenCalled();
  });

  it("blocks using session queue waitForEnqueue when session queue is active", async () => {
    const evt = makeEvent(56, "delayed session event");
    const mockSessionQueue = {
      dequeueBatch: vi.fn().mockReturnValueOnce([]).mockReturnValueOnce([evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValue(7);
    mocks.getSessionQueue.mockReturnValue(mockSessionQueue);

    const result = await call({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates[0].id).toBe(56);
    expect(mockSessionQueue.waitForEnqueue).toHaveBeenCalled();
    mocks.getActiveSession.mockReturnValue(0);
    mocks.getSessionQueue.mockReturnValue(undefined);
  });

  it("includes pending count when events arrive after blocking wait", async () => {
    const evt = makeEvent(66, "arrived after wait");
    mocks.dequeueBatch.mockReturnValueOnce([]).mockReturnValueOnce([evt]);
    mocks.pendingCount.mockReturnValue(3);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    const result = await call({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates[0].id).toBe(66);
    expect(data.pending).toBe(3);
  });

  it("uses explicit sid param over getActiveSession when provided", async () => {
    const evt = makeEvent(70, "explicit sid");
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    // getActiveSession returns a DIFFERENT session than the explicit sid
    mocks.getActiveSession.mockReturnValue(1);
    mocks.getSessionQueue.mockImplementation((sid: number) =>
      sid === 3 ? mockSessionQueue : undefined,
    );

    const result = await call({ token: 3_001_234, timeout: 0 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates[0].id).toBe(70);
    // getSessionQueue was called with the explicit sid, not the active one
    expect(mocks.getSessionQueue).toHaveBeenCalledWith(3);
    expect(mockSessionQueue.dequeueBatch).toHaveBeenCalled();
    // setActiveSession called to keep outbound attribution correct
    expect(mocks.setActiveSession).toHaveBeenCalledWith(3);
  });

  it("returns SID_REQUIRED error when identity is omitted", async () => {
    const result = await call({ timeout: 0 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("always re-syncs setActiveSession on return when explicit sid provided", async () => {
    mocks.getActiveSession.mockReturnValue(3);
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getSessionQueue.mockImplementation((sid: number) =>
      sid === 3 ? mockSessionQueue : undefined,
    );

    await call({ token: 3_001_234, timeout: 0 });
    // resync always fires so subsequent tool calls see the correct session
    expect(mocks.setActiveSession).toHaveBeenCalledWith(3);
  });

  it("re-syncs setActiveSession after blocking wait with explicit sid", async () => {
    const evt = makeEvent(80, "after wait");
    const mockSessionQueue = {
      dequeueBatch: vi.fn().mockReturnValueOnce([]).mockReturnValueOnce([evt] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getActiveSession.mockReturnValue(1);
    mocks.getSessionQueue.mockImplementation((sid: number) =>
      sid === 5 ? mockSessionQueue : undefined,
    );

    const result = await call({ token: 5_001_234, timeout: 1 });
    const data = parseResult<DequeueResult>(result);
    expect(data.updates).toBeDefined();
    // setActiveSession should have been called at least twice (start + return)
    const calls = mocks.setActiveSession.mock.calls.filter(
      (c: unknown[]) => c[0] === 5,
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("re-syncs setActiveSession on abort with explicit sid", async () => {
    const mockSessionQueue = {
      dequeueBatch: vi.fn(() => [] as TimelineEvent[]),
      pendingCount: vi.fn(() => 0),
      waitForEnqueue: vi.fn(() => new Promise(() => {})), // never resolves
    };
    mocks.getActiveSession.mockReturnValue(1);
    mocks.getSessionQueue.mockImplementation((sid: number) =>
      sid === 4 ? mockSessionQueue : undefined,
    );

    const controller = new AbortController();
    void Promise.resolve().then(() => { controller.abort(); });
    const result = await call({ token: 4_001_234, timeout: 60 }, { signal: controller.signal });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
    // resync must fire even on abort path
    expect(mocks.setActiveSession).toHaveBeenCalledWith(4);
  });

  it("does not call setActiveSession on session_closed path", async () => {
    mocks.getSessionQueue.mockReturnValue(undefined);
    await call({ token: 99_001_234 });
    expect(mocks.setActiveSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Abort signal
  // =========================================================================

  it("stops immediately when signal is already aborted", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    const controller = new AbortController();
    controller.abort();
    const result = await call({ timeout: 60, token: 1_123_456 }, { signal: controller.signal });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
  });

  it("stops waiting when signal is aborted while blocking", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(() => new Promise(() => {})); // never resolves
    const controller = new AbortController();
    void Promise.resolve().then(() => { controller.abort(); });
    const result = await call({ timeout: 60, token: 1_123_456 }, { signal: controller.signal });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
  });

  it("returns session_closed (not an error) when explicit sid has no session queue", async () => {
    mocks.getSessionQueue.mockReturnValue(undefined);
    const result = await call({ token: 42_001_234 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.error).toBe("session_closed");
    expect((data.message as string)).toContain("42");
  });

  it("returns session_closed when session queue does not exist", async () => {
    mocks.getSessionQueue.mockReturnValue(undefined);
    const result = await call({ token: 7_001_234 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.error).toBe("session_closed");
    expect((data.message as string)).toContain("7");
  });

  // =========================================================================
  // Auth gate — identity [sid, suffix] always required
  // =========================================================================

  describe("auth gate", () => {
    it("returns SID_REQUIRED when identity is omitted", async () => {
      const result = await call({ timeout: 0 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when suffix does not match", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ token: 3_009_999, timeout: 0 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("passes [sid, suffix] to validateSession when identity provided", async () => {
      const evt = makeEvent(1, "auth test");
      const mockSessionQueue = {
        dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);
      await call({ token: 3_001_234, timeout: 0 });
      expect(mocks.validateSession).toHaveBeenCalledWith(3, 1234);
    });

    it("allows dequeue when identity is valid", async () => {
      const evt = makeEvent(2, "authorized");
      const mockSessionQueue = {
        dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);
      const result = await call({ token: 3_001_234, timeout: 0 });
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].id).toBe(2);
    });
  });

  // =========================================================================
  // routing field — ambiguous vs targeted
  // =========================================================================

  describe("routing field", () => {
    function makeReplyEvent(id: number, replyTo: number): TimelineEvent {
      return {
        id,
        timestamp: new Date().toISOString(),
        event: "message",
        from: "user",
        content: { type: "text", text: "reply", reply_to: replyTo },
        _update: { update_id: id },
      };
    }

    it("adds routing: ambiguous for fresh message", async () => {
      mocks.getMessageOwner.mockReturnValue(0); // no owner → ambiguous
      const evt = makeEvent(10, "hello");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("ambiguous");
    });

    it("adds routing: targeted for reply-to message", async () => {
      mocks.getMessageOwner.mockImplementation((msgId: number) => msgId === 50 ? 1 : 0);
      const evt = makeReplyEvent(10, 50);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("targeted");
    });

    it("adds routing: targeted for callback event", async () => {
      mocks.getMessageOwner.mockImplementation((msgId: number) => msgId === 60 ? 2 : 0);
      const cbEvt: TimelineEvent = {
        id: 11,
        timestamp: new Date().toISOString(),
        event: "callback",
        from: "user",
        content: { type: "cb", data: "yes", target: 60 },
        _update: { update_id: 11 },
      };
      mocks.dequeueBatch.mockReturnValueOnce([cbEvt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("targeted");
    });

    it("adds routing: ambiguous when no governor is set", async () => {
      mocks.getMessageOwner.mockReturnValue(0);
      const evt = makeEvent(12, "hi");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("ambiguous");
    });

    it("adds routing to all events in a batch", async () => {
      mocks.getMessageOwner.mockReturnValue(0); // all ambiguous
      const evt1 = makeEvent(14, "first");
      const evt2 = makeEvent(15, "second");
      mocks.dequeueBatch.mockReturnValueOnce([evt1, evt2]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("ambiguous");
      expect(data.updates[1].routing).toBe("ambiguous");
    });

    it("treats reply to untracked message as ambiguous", async () => {
      // Reply to a message we don't track → treated as ambiguous (owner=0)
      mocks.getMessageOwner.mockReturnValue(0); // untracked → 0
      const evt = makeReplyEvent(16, 999);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates[0].routing).toBe("ambiguous");
    });
  });

  // =========================================================================
  // Heartbeat — touchSession
  // =========================================================================

  describe("touchSession heartbeat", () => {
    it("calls touchSession with the resolved sid when sid > 0 (explicit sid)", async () => {
      // Must provide a session queue for the explicit-sid path, otherwise
      // dequeue returns session_closed before calling touchSession.
      const mockSessionQueue = {
        dequeueBatch: vi.fn(() => [makeEvent(1, "hi")] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.activeSessionCount.mockReturnValue(1);
      mocks.getSessionQueue.mockReturnValueOnce(mockSessionQueue);
      await call({ timeout: 0, token: 5_001_234 });
      expect(mocks.touchSession).toHaveBeenCalledWith(5);
    });

    it("calls touchSession with the sid from identity", async () => {
      mocks.dequeueBatch.mockReturnValueOnce([makeEvent(1, "hi")]);
      mocks.pendingCount.mockReturnValue(0);
      await call({ timeout: 0, token: 1_123_456 });
      expect(mocks.touchSession).toHaveBeenCalledWith(1);
    });

    it("does not call touchSession when sid is 0", async () => {
      // identity [0, suffix]: sid=0 → touchSession guard (sid > 0) prevents call
      const mockQueue0 = {
        dequeueBatch: vi.fn(() => [] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockImplementation((sid: number) =>
        sid === 0 ? mockQueue0 : undefined,
      );
      await call({ token: 123456, timeout: 0 });
      expect(mocks.touchSession).not.toHaveBeenCalled();
    });

    it("calls touchSession on blocking wait path before returning batch", async () => {
      // Must provide a session queue for the explicit-sid path.
      const evt = makeEvent(10, "delayed");
      const mockSessionQueue = {
        dequeueBatch: vi.fn()
          .mockReturnValueOnce([] as TimelineEvent[])
          .mockReturnValueOnce([evt] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.activeSessionCount.mockReturnValue(1);
      mocks.getSessionQueue.mockReturnValue(mockSessionQueue);
      await call({ timeout: 1, token: 7_001_234 });
      expect(mocks.touchSession).toHaveBeenCalledWith(7);
      mocks.getSessionQueue.mockReturnValue(undefined);
    });
  });

  // =========================================================================
  // force gate — timeout exceeds session default
  // =========================================================================

  describe("force gate", () => {
    it("rejects timeout > session default when force is false (default)", async () => {
      // Session default is 60; timeout 200 exceeds it → rejected
      mocks.getDequeueDefault.mockReturnValue(60);
      const result = await call({ timeout: 200, token: 1_123_456 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
      expect(data.message).toContain("200");
      expect(data.message).toContain("60");
    });

    it("rejects timeout > session default when force is explicitly false", async () => {
      mocks.getDequeueDefault.mockReturnValue(60);
      const result = await call({ timeout: 200, force: false, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
    });

    it("allows timeout > session default when force is true", async () => {
      // Use getDequeueDefault=1 so timeout=2 > 1, but actual poll only waits 1s
      mocks.getDequeueDefault.mockReturnValue(1);
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 2, force: true, token: 1_123_456 });
      // Should NOT return TIMEOUT_EXCEEDS_DEFAULT — actual poll behavior fires
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.timed_out).toBe(true);
    });

    it("allows timeout <= session default without force", async () => {
      mocks.getDequeueDefault.mockReturnValue(2);
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 1, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.timed_out).toBe(true);
    });

    it("allows timeout > default with custom session default of 600 (simulated)", async () => {
      // Simulate: default is set to 5 (>1 second realistic), timeout=3 < 5 → passes
      mocks.getDequeueDefault.mockReturnValue(5);
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 3, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.timed_out).toBe(true);
    });

    it("hint field in structured error response guides the user", async () => {
      mocks.getDequeueDefault.mockReturnValue(60);
      const result = await call({ timeout: 200, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
      expect(typeof data.hint).toBe("string");
      expect(data.hint as string).toContain("force: true");
      expect(data.hint as string).toContain("profile/dequeue-default");
    });

    it("hint is omitted on subsequent TIMEOUT_EXCEEDS_DEFAULT responses for the same session", async () => {
      mocks.getDequeueDefault.mockReturnValue(60);
      // First call — hint should be present
      const first = await call({ timeout: 200, token: 1_123_456 });
      expect(parseResult(first).hint).toBeDefined();
      // Second call — hint should be omitted
      const second = await call({ timeout: 200, token: 1_123_456 });
      expect(parseResult(second).hint).toBeUndefined();
    });

    it("rejects explicit timeout above schema cap (timeout: 301) with a validation error", async () => {
      // The schema enforces .max(300) — timeout: 301 must be rejected at schema level,
      // before the handler runs. The mock server re-throws non-token ZodErrors.
      await expect(call({ timeout: 301, token: 1_123_456 })).rejects.toThrow();
    });

    // -------------------------------------------------------------------------
    // Task 10-249: session default interaction tests
    // -------------------------------------------------------------------------

    it("omitting timeout uses session default not server fallback — gate skipped", async () => {
      // With session default=1 (small, to avoid long waits), omitting timeout →
      // effectiveTimeout=1, gate is NOT fired (timeout is undefined).
      mocks.getDequeueDefault.mockReturnValue(1);
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ token: 1_123_456 }); // no timeout param
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.timed_out).toBe(true);
      expect(mocks.waitForEnqueue).toHaveBeenCalled();
    });

    it("explicit timeout=1 with session default=2 passes gate without force", async () => {
      // 1 <= 2 → gate does not fire
      mocks.getDequeueDefault.mockReturnValue(2);
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 1, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.timed_out).toBe(true);
    });

    it("explicit timeout=300 with session default=60 triggers gate", async () => {
      // 300 > 60 and force not set → TIMEOUT_EXCEEDS_DEFAULT
      mocks.getDequeueDefault.mockReturnValue(60);
      const result = await call({ timeout: 300, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
      expect(data.message).toContain("300");
      expect(data.message).toContain("60");
      // Reset to a value >= 300 so the reminder fire path test is not affected.
      // vi.clearAllMocks() clears call history but NOT mockReturnValue state,
      // so a low sessionDefault here would cause the gate to fire in the next test.
      mocks.getDequeueDefault.mockReturnValue(300);
    });
  });

  // =========================================================================
  // max_wait parameter — primary name and backward-compat alias
  // =========================================================================

  describe("max_wait parameter", () => {
    it("accepts max_wait: 0 as the primary instant-poll parameter", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ max_wait: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(0);
    });

    it("accepts max_wait for blocking poll", async () => {
      const evt = makeEvent(50, "via max_wait");
      mocks.dequeueBatch.mockReturnValueOnce([]).mockReturnValueOnce([evt]);
      mocks.waitForEnqueue.mockResolvedValue(undefined);
      const result = await call({ max_wait: 1, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0].id).toBe(50);
    });

    it("backward-compat: timeout alias still works as instant poll", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(0);
    });

    it("max_wait takes precedence over timeout alias when both provided", async () => {
      // max_wait: 0 → instant poll; timeout: 300 → long block. max_wait wins.
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ max_wait: 0, timeout: 300, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(0);
    });

    it("force gate uses max_wait value when set via max_wait", async () => {
      mocks.getDequeueDefault.mockReturnValue(60);
      const result = await call({ max_wait: 200, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
      expect(data.message).toContain("200");
    });
  });

  // =========================================================================
  // Timer overflow guard — MAX_SET_TIMEOUT_MS clamp
  // =========================================================================

  describe("MAX_SET_TIMEOUT_MS clamp", () => {
    it("clamps setTimeout delay to exactly MAX_SET_TIMEOUT_MS when session default exceeds it", async () => {
      // Arrange: getDequeueDefault returns 3_000_000 s → waitMs = ~3_000_000_000 ms,
      // which exceeds MAX_SET_TIMEOUT_MS (2_000_000_000). At least one setTimeout call
      // should be clamped to exactly 2_000_000_000 ms.
      const originalSetTimeout = globalThis.setTimeout;
      const capturedDelays: number[] = [];
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
        (fn: Parameters<typeof globalThis.setTimeout>[0], delay?: number) => {
          if (typeof delay === "number") capturedDelays.push(delay);
          return originalSetTimeout(fn as () => void, 0);
        },
      );

      try {
        mocks.getDequeueDefault.mockReturnValue(3_000_000); // 3B ms → exceeds cap
        mocks.dequeueBatch.mockReturnValue([]);
        mocks.waitForEnqueue.mockReturnValue(new Promise(() => {}));

        const controller = new AbortController();
        void Promise.resolve().then(() => { controller.abort(); });

        await call({ token: 1_123_456 }, { signal: controller.signal });

        const MAX_SET_TIMEOUT_MS = 2_000_000_000;
        expect(capturedDelays.length).toBeGreaterThan(0);
        expect(capturedDelays).toContain(MAX_SET_TIMEOUT_MS);
      } finally {
        setTimeoutSpy.mockRestore();
        mocks.getDequeueDefault.mockReturnValue(300);
      }
    });

  });

  // =========================================================================
  // First-dequeue hint — removed (lean responses)
  // =========================================================================

  describe("first-dequeue hint (removed)", () => {
    beforeEach(() => {
      _resetFirstDequeueHintForTest();
    });

    it("does not include hint on first dequeue call (empty result)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.hint).toBeUndefined();
    });

    it("does not include hint on first dequeue call (batch result)", async () => {
      const evt = makeEvent(200, "first call with events");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult(result);
      expect(data.updates).toBeDefined();
      expect(data.hint).toBeUndefined();
    });

    it("no hint on any subsequent calls either", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      await call({ timeout: 0, token: 1_123_456 });
      const result2 = await call({ timeout: 0, token: 1_123_456 });
      const data2 = parseResult(result2);
      expect(data2.hint).toBeUndefined();
    });
  });

  // =========================================================================
  // Voice backlog hint
  // =========================================================================

  describe("voice backlog hint", () => {
    it("includes hint when batch has voice and pending queue has voice", async () => {
      const evt = makeVoiceEvent(101);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      mocks.peekSessionCategories.mockReturnValue({ voice: 2 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeDefined();
      expect(typeof data.hint).toBe("string");
    });

    it("does not include hint when batch has voice but no pending voice", async () => {
      const evt = makeVoiceEvent(102);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(0);
      mocks.peekSessionCategories.mockReturnValue({ voice: 0 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeUndefined();
    });

    it("does not include voice hint when batch is text-only even if pending voice exists", async () => {
      const evt = makeEvent(103, "text only");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(1);
      mocks.peekSessionCategories.mockReturnValue({ voice: 3 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      // No voice backlog hint, but pending nudge IS present (pending=1)
      expect(data.hint).toBeDefined();
      expect(data.hint).toContain("pending=1");
    });

    it("does not include voice hint when batch has voice but only text is pending (no voice key)", async () => {
      const evt = makeVoiceEvent(104);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      // peekSessionCategories returns text but no voice
      mocks.peekSessionCategories.mockReturnValue({ text: 2 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      // No voice backlog hint, but pending nudge IS present (pending=2)
      expect(data.hint).toBeDefined();
      expect(data.hint).toContain("pending=2");
    });

    it("cascade: consecutive dequeues in a voice backlog each produce a hint", async () => {
      const v1 = makeVoiceEvent(110);
      const v2 = makeVoiceEvent(111);

      // First dequeue: returns v1, 1 voice still pending
      mocks.dequeueBatch.mockReturnValueOnce([v1]);
      mocks.pendingCount.mockReturnValueOnce(1);
      mocks.peekSessionCategories.mockReturnValueOnce({ voice: 1 });
      const result1 = await call({ timeout: 0, token: 1_123_456 });
      const data1 = parseResult<DequeueResult>(result1);
      expect(data1.hint).toBeDefined();
      expect(data1.hint).toContain("pending=1");

      // Second dequeue: returns v2, 0 voice pending (backlog exhausted)
      mocks.dequeueBatch.mockReturnValueOnce([v2]);
      mocks.pendingCount.mockReturnValueOnce(0);
      mocks.peekSessionCategories.mockReturnValueOnce({ voice: 0 });
      const result2 = await call({ timeout: 0, token: 1_123_456 });
      const data2 = parseResult<DequeueResult>(result2);
      expect(data2.hint).toBeUndefined();
    });
  });

  // =========================================================================
  // Pending-queue nudge hint
  // =========================================================================

  describe("pending-queue nudge hint", () => {
    it("does not include pending nudge hint when pending is 0", async () => {
      const evt = makeEvent(200, "no backlog");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(0);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBeUndefined();
      // hint should not contain a pending nudge; it may be undefined or contain
      // other hints (e.g. silence/voice) — just confirm no pending nudge text
      expect(data.hint ?? "").not.toContain("pending=");
    });

    it("includes pending nudge hint with correct N when pending > 0", async () => {
      // peekSessionCategories is not mocked here: the voice hint requires a voice
      // event in the batch; this is a text event so the voice hint cannot fire.
      const evt = makeEvent(201, "has backlog");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(2);
      expect(data.hint).toBeDefined();
      expect(data.hint).toContain("pending=2");
      expect(typeof data.hint).toBe("string");
    });

    it("pending nudge hint reflects the exact pending count", async () => {
      const evt = makeEvent(202, "large backlog");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(7);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toContain("pending=7");
    });

    it("pending nudge coexists with voice backlog hint in hint string", async () => {
      const evt = makeVoiceEvent(203);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(3);
      mocks.peekSessionCategories.mockReturnValue({ voice: 3 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toContain("pending=3");
    });
  });

  // =========================================================================
  // Reminder fire path — tokenHint propagation
  // =========================================================================

  // =========================================================================
  // promoteDeferred — called on every dequeue path (regression: bug-bridge-reminder-fire-failure)
  // =========================================================================

  describe("promoteDeferred called on all dequeue paths", () => {
    it("calls promoteDeferred before returning immediate batch (busy-session bug fix)", async () => {
      // Before the fix, promoteDeferred was only called inside the long-poll loop.
      // A session with constant message activity always took the immediate-batch path,
      // leaving deferred reminders stuck in deferred state indefinitely.
      const evt = makeEvent(1, "immediate message");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      await call({ timeout: 300, token: 1_123_456 });
      expect(reminderMocks.promoteDeferred).toHaveBeenCalledWith(1);
    });

    it("calls promoteDeferred on timeout=0 instant poll (empty queue)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      await call({ timeout: 0, token: 1_123_456 });
      expect(reminderMocks.promoteDeferred).toHaveBeenCalledWith(1);
    });

    it("calls promoteDeferred on timeout=0 instant poll (immediate batch)", async () => {
      const evt = makeEvent(2, "batch on instant poll");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      await call({ max_wait: 0, token: 1_123_456 });
      expect(reminderMocks.promoteDeferred).toHaveBeenCalledWith(1);
    });
  });

  describe("reminder fire path", () => {
    it("does NOT return reminder updates — reminders now delivered via session-queue", async () => {
      const fakeStart = Date.now();
      const fakeReminder = { id: "rem-1", text: "test reminder", recurring: false,
        delay_seconds: 0, created_at: fakeStart, activated_at: fakeStart, state: "active" as const };
      reminderMocks.getActiveReminders.mockReturnValue([fakeReminder]);
      reminderMocks.popActiveReminders.mockReturnValue([fakeReminder]);

      const result = await call({ timeout: 0, token: 1_123_456 });  // timeout:0 to avoid spin
      const data = parseResult(result);

      // Dequeue should return an empty response (pending-only), NOT reminder updates
      // timeout:0 returns { pending: N } not { timed_out: true }
      expect(data.updates ?? []).toHaveLength(0);
      expect(data.timed_out).toBeUndefined();
      // popActiveReminders NOT called by dequeue (§5-b moved delivery to session-queue)
      expect(reminderMocks.popActiveReminders).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Reminder notify — activity file monitor wakeup on reminder return
  // =========================================================================

  describe("reminder notify (activity monitor wakeup)", () => {
    it("P1-P3 (§5-b): dequeue does NOT call notifyIfAllowed for reminder delivery — moved to session-queue", async () => {
      // Reminder content exists but dequeue should not deliver it
      reminderMocks.popFireableEventReminders.mockReturnValue([{ text: "event reminder" }]);
      reminderMocks.getActiveReminders.mockReturnValue([{ text: "active reminder" }]);

      await call({ timeout: 0, token: 1_123_456 });

      // notifyIfAllowed should NOT be called — delivery is now via deliverReminderEvent in session-queue
      expect(fileStateMocks.notifyIfAllowed).not.toHaveBeenCalled();
    });

    it("timeout=0 empty-poll does NOT call notifyIfAllowed", async () => {
      await call({ timeout: 0, token: 1_123_456 });

      expect(fileStateMocks.notifyIfAllowed).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // timeout-exit releases notify debounce
  // =========================================================================

  describe("timeout-exit debounce release", () => {
    it("releaseNotifyDebounce is called after a blocking wait that times out", async () => {
      // Arrange: dequeue blocks, no content ever arrives, times out
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(() => delay(50));

      await call({ timeout: 1, token: 1_123_456 });

      // Primary assertion: releaseNotifyDebounce MUST be called on timeout exit
      expect(fileStateMocks.releaseNotifyDebounce).toHaveBeenCalledWith(1);
    });

    it("releaseNotifyDebounce is also called on content-returning paths (no regression)", async () => {
      // Content-returning path: batch arrives immediately
      const evt = makeEvent(42, "content");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);

      await call({ timeout: 300, token: 1_123_456 });

      expect(fileStateMocks.releaseNotifyDebounce).toHaveBeenCalledWith(1);
    });

    it("timeout=0 instant-poll does NOT call releaseNotifyDebounce (empty-poll guard preserved)", async () => {
      // timeout=0 takes a different early-return path — debounce not released
      mocks.dequeueBatch.mockReturnValue([]);

      await call({ timeout: 0, token: 1_123_456 });

      expect(fileStateMocks.releaseNotifyDebounce).not.toHaveBeenCalled();
    });

    it("subsequent notifyIfAllowed fires after timeout exit (end-to-end AC1)", async () => {
      // Verify that after a timeout exit releases the debounce, the next notify is not suppressed.
      // This requires the real file-state module (not the mock), so we verify via
      // the dequeue mock: releaseNotifyDebounce was called → debounce is cleared → notify allowed.
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(() => delay(50));

      await call({ timeout: 1, token: 1_123_456 });

      // releaseNotifyDebounce was called — a file-parked agent would now accept a notify
      expect(fileStateMocks.releaseNotifyDebounce).toHaveBeenCalledWith(1);
    });
  });

  // =========================================================================
  // Option A — Duplicate session detection (connection_token mismatch)
  // =========================================================================

  describe("duplicate session detection (Option A)", () => {
    // Valid v4 UUIDs for use across tests
    const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
    const UUID_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

    it("does not alert governor when connection_token matches stored token", async () => {
      const evt = makeEvent(1, "hello");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.checkConnectionToken.mockReturnValue("match");
      mocks.getGovernorSid.mockReturnValue(2); // governor exists

      const result = await call({ token: 1_123_456, timeout: 0, connection_token: UUID_A });
      expect(isError(result)).toBe(false);
      // Governor should NOT be alerted on a match
      expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    });

    it("does not alert governor when connection_token is absent (legacy caller)", async () => {
      const evt = makeEvent(2, "no token");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.checkConnectionToken.mockReturnValue("absent");
      mocks.getGovernorSid.mockReturnValue(2);

      await call({ token: 1_123_456, timeout: 0 }); // no connection_token
      expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    });

    it("alerts governor when connection_token mismatches stored token", async () => {
      const evt = makeEvent(3, "duplicate");
      const mockSessionQueue = {
        dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockImplementation((sid: number) =>
        sid === 1 ? mockSessionQueue : undefined,
      );
      mocks.checkConnectionToken.mockReturnValue("mismatch");
      mocks.getGovernorSid.mockReturnValue(2); // governor is SID 2

      await call({ token: 1_123_456, timeout: 0, connection_token: UUID_B });

      // Governor (SID 2) should receive a service message alert
      expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
        2,
        expect.any(String),
        "duplicate_session_detected",
        expect.objectContaining({ sid: 1 }),
      );
    });

    it("does not alert when governor sid is 0 (no governor set)", async () => {
      const evt = makeEvent(4, "no governor");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.checkConnectionToken.mockReturnValue("mismatch");
      mocks.getGovernorSid.mockReturnValue(0); // no governor

      await call({ token: 1_123_456, timeout: 0, connection_token: UUID_A });
      // No governor to alert — silently drops
      expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    });

    it("does not alert governor when the duplicate IS the governor (avoids self-alert)", async () => {
      const evt = makeEvent(5, "self alert guard");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.checkConnectionToken.mockReturnValue("mismatch");
      mocks.getGovernorSid.mockReturnValue(1); // governor SID == caller SID

      await call({ token: 1_123_456, timeout: 0, connection_token: UUID_B });
      // Governor === duplicate session: skip alert to avoid self-delivery
      expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    });

    it("still returns valid dequeue result even after a mismatch alert", async () => {
      const evt = makeEvent(6, "still proceeds");
      const mockSessionQueue = {
        dequeueBatch: vi.fn(() => [evt] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockImplementation((sid: number) =>
        sid === 1 ? mockSessionQueue : undefined,
      );
      mocks.checkConnectionToken.mockReturnValue("mismatch");
      mocks.getGovernorSid.mockReturnValue(2);

      const result = await call({ token: 1_123_456, timeout: 0, connection_token: UUID_A });
      // Call must NOT be rejected — the duplicate alert is advisory only
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect(data.updates).toBeDefined();
      expect(data.updates[0].id).toBe(6);
    });

    it("does not call checkConnectionToken when sid is 0", async () => {
      // sid=0 is the no-session sentinel — skip duplicate check
      const mockQueue0 = {
        dequeueBatch: vi.fn(() => [] as TimelineEvent[]),
        pendingCount: vi.fn(() => 0),
        waitForEnqueue: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getSessionQueue.mockImplementation((sid: number) =>
        sid === 0 ? mockQueue0 : undefined,
      );
      await call({ token: 123456, timeout: 0, connection_token: UUID_B });
      expect(mocks.checkConnectionToken).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Option B — Dead session explicit error (existing behavior confirmed)
  // =========================================================================

  describe("dead session explicit error (Option B)", () => {
    it("returns session_closed with isError: false when no session queue exists", async () => {
      mocks.getSessionQueue.mockReturnValue(undefined);
      const result = await call({ token: 5_001_234 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.error).toBe("session_closed");
      expect(typeof data.message).toBe("string");
      expect((data.message as string).length).toBeGreaterThan(0);
    });

    it("includes the SID in the session_closed message", async () => {
      mocks.getSessionQueue.mockReturnValue(undefined);
      const result = await call({ token: 13_001_234 });
      const data = parseResult(result);
      expect(data.error).toBe("session_closed");
      expect((data.message as string)).toContain("13");
    });

    it("does not set setActiveSession on session_closed path", async () => {
      mocks.getSessionQueue.mockReturnValue(undefined);
      await call({ token: 8_001_234 });
      expect(mocks.setActiveSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // response_format: "compact" — omits timed_out fields
  // =========================================================================

  describe("response_format: compact", () => {
    it("compact: instant poll returns pending only (no empty field in any mode)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ timeout: 0, token: 1_123_456, response_format: "compact" });
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect((data as unknown as Record<string, unknown>).empty).toBeUndefined();
      // pending is still present
      expect(data.pending).toBe(0);
    });

    it("compact: timed_out:true is present when blocking wait expires (always emitted)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 1, token: 1_123_456, response_format: "compact" });
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect(data.timed_out).toBe(true);
    });

    it("default: pending-only on instant poll (response_format: default)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ timeout: 0, token: 1_123_456, response_format: "default" });
      const data = parseResult<DequeueResult>(result);
      expect((data as unknown as Record<string, unknown>).empty).toBeUndefined();
      expect(data.pending).toBe(0);
    });

    it("default: timed_out:true is present when blocking wait expires (response_format: default)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 1, token: 1_123_456, response_format: "default" });
      const data = parseResult<DequeueResult>(result);
      expect(data.timed_out).toBe(true);
    });

    it("omitted response_format: pending-only on instant poll (backward compat)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect((data as unknown as Record<string, unknown>).empty).toBeUndefined();
      expect(data.pending).toBe(0);
    });

    it("omitted response_format: timed_out:true is present (backward compat)", async () => {
      mocks.dequeueBatch.mockReturnValue([]);
      mocks.waitForEnqueue.mockImplementation(
        () => delay(50),
      );
      const result = await call({ timeout: 1, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.timed_out).toBe(true);
    });

    it("compact has no effect on batch responses — shape is identical to default", async () => {
      const evt = makeEvent(42, "batch event");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(1);
      const resultCompact = await call({ timeout: 0, token: 1_123_456, response_format: "compact" });
      const dataCompact = parseResult<DequeueResult>(resultCompact);
      expect(dataCompact.updates).toHaveLength(1);
      expect(dataCompact.updates[0].id).toBe(42);
      expect(dataCompact.pending).toBe(1);

      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(1);
      const resultDefault = await call({ timeout: 0, token: 1_123_456, response_format: "default" });
      const dataDefault = parseResult<DequeueResult>(resultDefault);
      expect(dataDefault.updates).toHaveLength(1);
      expect(dataDefault.updates[0].id).toBe(42);
      expect(dataDefault.pending).toBe(1);

      // Compact and default batch shapes are identical
      expect(JSON.stringify(dataCompact)).toBe(JSON.stringify(dataDefault));
    });
  });

  // =========================================================================
  // Activity file onboarding hint — REMOVED 2026-05-22
  // ONBOARDING_LOOP_PATTERN at session start now covers the activity-file
  // guidance once; the redundant hint on first dequeue was deleted.
  // =========================================================================

  // =========================================================================
  // suppress_pending_hint profile flag (AC1–AC5)
  // =========================================================================

  describe("suppress_pending_hint profile flag", () => {
    // AC2: hint field is omitted when suppress_pending_hint is true, even with pending > 0
    it("omits hint field when session suppress_pending_hint is true and pending > 0", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession", suppress_pending_hint: true });
      const evt = makeEvent(300, "has backlog");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(3);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      // AC3: pending count is still present
      expect(data.pending).toBe(3);
      // AC2: hint is suppressed
      expect(data.hint).toBeUndefined();
    });

    // AC3: pending count is unaffected by the flag
    it("leaves pending count intact when suppress_pending_hint is true", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession", suppress_pending_hint: true });
      const evt = makeEvent(301, "pending check");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(5);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(5);
    });

    // AC5: removing the flag (suppress_pending_hint: false) restores hint display
    it("restores hint field when suppress_pending_hint is false", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession", suppress_pending_hint: false });
      const evt = makeEvent(302, "hint restored");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.pending).toBe(2);
      expect(data.hint).toBeDefined();
      expect(data.hint).toContain("pending=2");
    });

    // AC5: undefined suppress_pending_hint (default) shows hint
    it("shows hint field when suppress_pending_hint is undefined (default behavior)", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession" }); // no suppress_pending_hint
      const evt = makeEvent(303, "default behavior");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(1);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeDefined();
      expect(data.hint).toContain("pending=1");
    });

    // AC2: voice backlog hint is also suppressed when flag is true
    it("suppresses voice backlog hint along with pending hint when flag is true", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession", suppress_pending_hint: true });
      const evt = makeVoiceEvent(304);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      mocks.peekSessionCategories.mockReturnValue({ voice: 2 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeUndefined();
      // pending count still present
      expect(data.pending).toBe(2);
    });

    // suppress_pending_hint has no effect when pending is 0 (hint would be absent anyway)
    it("hint remains absent when pending is 0 regardless of suppress_pending_hint", async () => {
      mocks.getSession.mockReturnValue({ name: "TestSession", suppress_pending_hint: true });
      const evt = makeEvent(305, "no backlog");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(0);
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeUndefined();
      expect(data.pending).toBeUndefined();
    });
  });
});

// =============================================================================
// checkDequeueRate — runaway-dequeue rate guard
// =============================================================================
describe("checkDequeueRate (runaway-dequeue rate guard)", () => {
  const SID = 42;
  const TOKEN = SID * 1_000_000 + 123_456; // e.g. 42_123_456

  beforeEach(() => {
    vi.clearAllMocks();
    _resetDequeueRateForTest();
    _resetDequeueThrottleForTest(); // clear backoff state so it doesn't slow tests
    _setBackoffSleepForTest(() => Promise.resolve()); // instant sleep — don't block rate tests
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
  });

  it("does not warn when attempts are below threshold", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 19 calls — just under RATE_THRESHOLD (20)
    for (let i = 0; i < 19; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("RUNAWAY DEQUEUE"),
      "behavior_runaway_dequeue",
    );
  });

  it("delivers a behavior_runaway_dequeue warning on the 20th attempt", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 20 calls — meets RATE_THRESHOLD
    for (let i = 0; i < 20; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      expect.stringContaining("RUNAWAY DEQUEUE"),
      "behavior_runaway_dequeue",
    );
  });

  it("does not repeat the warning within the 30s cooldown", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Trigger the warning
    for (let i = 0; i < 20; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCount = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_runaway_dequeue",
    ).length;
    expect(warnCount).toBe(1);

    // 10 more calls within the same window — cooldown should suppress second warn
    for (let i = 0; i < 10; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCountAfter = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_runaway_dequeue",
    ).length;
    expect(warnCountAfter).toBe(1);
  });

  it("prunes old attempts outside the 60s window so a settled session does not retrigger", async () => {
    // Directly manipulate the rate state by calling via runDrainLoop 19 times,
    // then reset so all existing timestamps are treated as old, and confirm
    // 19 fresh calls (well under threshold) do not warn.
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 19 calls to build up state
    for (let i = 0; i < 19; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // Reset only the rate state (simulating 60s passing) without resetting mocks
    _resetDequeueRateForTest();

    // 19 fresh calls — still under threshold
    for (let i = 0; i < 19; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("RUNAWAY DEQUEUE"),
      "behavior_runaway_dequeue",
    );
  });
});

// =============================================================================
// checkSubTimeoutDequeue — AC1: sub-timeout interval detection
// =============================================================================
describe("checkSubTimeoutDequeue (AC1 — sub-timeout interval detection)", () => {
  const SID = 55;
  const TOKEN = SID * 1_000_000 + 123_456;

  // Helper: fake the clock so consecutive calls appear to be N ms apart
  function makeTimedCall(
    call: (args: Record<string, unknown>) => Promise<unknown>,
    intervalMs: number,
  ) {
    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
    return async (n: number) => {
      for (let i = 0; i < n; i++) {
        if (i > 0) fakeNow += intervalMs;
        await call({ timeout: 0, token: TOKEN });
      }
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    _resetDequeueThrottleForTest();
    _setBackoffSleepForTest(() => Promise.resolve()); // instant sleep — don't block sub-timeout tests
    _resetDequeueRateForTest();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not warn when only 9 consecutive sub-timeout dequeues (below threshold of 10)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");
    const runTimed = makeTimedCall(call, 10_000); // 10s apart — below 60s reference

    await runTimed(10); // 1 baseline + 9 intervals = 9 consecutive sub-timeout — still below 10

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });

  it("fires behavior_dequeue_sub_timeout after 10 consecutive sub-timeout intervals", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");
    const runTimed = makeTimedCall(call, 10_000); // 10s apart — below 60s reference

    await runTimed(11); // 1 baseline + 10 intervals = 10 consecutive sub-timeout → fires

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });

  it("does not warn when intervals are all >= 60s (above reference)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");
    const runTimed = makeTimedCall(call, 65_000); // 65s apart — above 60s reference

    await runTimed(10); // many calls, but all intervals above threshold

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });

  it("resets the consecutive count when a normal (>=60s) interval is observed", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    // 4 consecutive sub-timeout calls (10s apart) — just below threshold
    for (let i = 0; i < 5; i++) {
      if (i > 0) fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    // One normal-interval call (70s later) — resets the count
    fakeNow += 70_000;
    await call({ timeout: 0, token: TOKEN });

    // 4 more sub-timeout calls — counter starts fresh, still below threshold
    for (let i = 0; i < 4; i++) {
      fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    // Should NOT have warned — count was reset by the normal interval
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });

  it("does not repeat the warning within the 120s cooldown", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    // Trigger the warning (11 calls at 10s each = 10 consecutive sub-timeout intervals)
    for (let i = 0; i < 11; i++) {
      if (i > 0) fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCount1 = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_dequeue_sub_timeout",
    ).length;
    expect(warnCount1).toBe(1);

    // More sub-timeout calls within the 120s cooldown window
    for (let i = 0; i < 5; i++) {
      fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCount2 = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_dequeue_sub_timeout",
    ).length;
    expect(warnCount2).toBe(1); // still just 1 — cooldown suppresses repeat
  });

  it("normal dequeue (content returned) unaffected by sub-timeout guard", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    const evt = makeEvent(42, "normal content");
    mocks.dequeueBatch.mockReturnValue([evt]);

    // Many rapid calls, all returning content — no sub-timeout warning
    for (let i = 0; i < 10; i++) {
      const result = await call({ timeout: 0, token: TOKEN });
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect(data.updates).toHaveLength(1);
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });
});

// =============================================================================
// checkZeroResultRapidFire — AC2: zero-result instant-poll detection
// =============================================================================
describe("checkZeroResultRapidFire (AC2 — zero-result instant-poll detection)", () => {
  const SID = 66;
  const TOKEN = SID * 1_000_000 + 123_456;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    _resetDequeueThrottleForTest();
    _setBackoffSleepForTest(() => Promise.resolve()); // instant sleep — don't block zero-result tests
    _resetDequeueRateForTest();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not warn after 4 consecutive zero-result instant polls (below threshold)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 4 instant polls, all empty
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });

  it("fires behavior_dequeue_zero_result on the 5th consecutive empty instant poll", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 5 instant polls, all empty → fires on 5th
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });

  it("resets zero-result counter when content is returned (AC3)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 4 empty polls
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // One content-returning poll resets the counter
    const evt = makeEvent(99, "content arrives");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    await call({ timeout: 0, token: TOKEN });

    // 4 more empty polls — counter was reset, still below threshold
    mocks.dequeueBatch.mockReturnValue([]);
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });

  it("does not warn for long-poll timeouts (timed_out: true is not rapid-fire)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Patient long-poll — returns timed_out after each wait.
    // Use a very short timeout so the test completes quickly; the key is that
    // timed_out exits do NOT count as zero-result rapid-fire events.
    mocks.waitForEnqueue.mockImplementation(() => delay(50));

    // 3 calls well above the threshold if timed_out counted — proves they don't.
    for (let i = 0; i < 3; i++) {
      const result = await call({ timeout: 1, token: TOKEN });
      const data = parseResult(result);
      expect(data.timed_out).toBe(true);
    }

    // Then 5 instant polls (which DO count) to reach the threshold
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // Warning fires from the 5 instant polls, NOT from the timed_out calls
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );

    // Confirm the warning fires only once (from the 5 instant polls)
    const warnCount = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_dequeue_zero_result",
    ).length;
    expect(warnCount).toBe(1);
  });

  it("does not repeat the warning within the 120s cooldown", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Trigger the first warning (5 empty instant polls)
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCount1 = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_dequeue_zero_result",
    ).length;
    expect(warnCount1).toBe(1);

    // More empty polls within cooldown — cooldown suppresses repeat
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    const warnCount2 = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => c[2] === "behavior_dequeue_zero_result",
    ).length;
    expect(warnCount2).toBe(1); // still just 1
  });

  it("normal dequeue behavior (content arrives) is entirely unaffected", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Content returns on every call — zero-result counter never accumulates
    const evt = makeEvent(77, "always content");
    mocks.dequeueBatch.mockReturnValue([evt]);

    for (let i = 0; i < 20; i++) {
      const result = await call({ timeout: 0, token: TOKEN });
      expect(isError(result)).toBe(false);
      const data = parseResult<DequeueResult>(result);
      expect(data.updates).toHaveLength(1);
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });

  it("blocking-wait path (content arrives after wait) also resets zero-result counter", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 4 empty instant polls
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // One blocking-wait call that returns content — should reset counter
    const evt = makeEvent(88, "from blocking wait");
    mocks.dequeueBatch
      .mockReturnValueOnce([]) // empty on first check → triggers block wait
      .mockReturnValueOnce([evt]); // arrives after wait
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    await call({ timeout: 1, token: TOKEN });

    // 4 more empty instant polls — counter reset, no warning
    mocks.dequeueBatch.mockReturnValue([]);
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });
});

// =============================================================================
// Exponential backoff (AC3) — delay before honoring next dequeue on detection
// =============================================================================
describe("exponential backoff (AC3 — delay on detection event)", () => {
  const SID = 77;
  const TOKEN = SID * 1_000_000 + 123_456;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    _resetDequeueThrottleForTest();
    _resetDequeueRateForTest();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
    // Use instant sleep so backoff doesn't slow tests
    _setBackoffSleepForTest(() => Promise.resolve());
  });

  afterEach(() => {
    _setBackoffSleepForTest(undefined);
    vi.restoreAllMocks();
  });

  it("sets backoff to 5 s (initial) when zero-result detection fires", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 5 consecutive empty instant polls → fires zero-result detection
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(_getBackoffDelayForTest(SID)).toBe(5_000);
  });

  it("doubles backoff on second detection (5 s → 10 s)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    // First detection: 5 consecutive zero-result instant polls → backoff = 5 s
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }
    expect(_getBackoffDelayForTest(SID)).toBe(5_000);

    // Advance past the 120s warning cooldown
    fakeNow += 130_000;

    // One more empty poll: count already at threshold (5), cooldown expired → second detection
    await call({ timeout: 0, token: TOKEN });
    expect(_getBackoffDelayForTest(SID)).toBe(10_000);
  });

  it("caps backoff at 60 s (does not exceed BACKOFF_MAX_MS)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    // Trigger enough detection events to saturate the cap: 5→10→20→40→60
    // Each detection requires 10 sub-timeout calls + passing 120s cooldown.
    for (let trigger = 0; trigger < 5; trigger++) {
      // Advance past cooldown before each trigger
      fakeNow += 130_000;
      for (let i = 0; i < 10; i++) {
        fakeNow += 10_000;
        await call({ timeout: 0, token: TOKEN });
      }
    }

    // After 5 triggers the backoff should be capped at 60 s (5→10→20→40→60)
    expect(_getBackoffDelayForTest(SID)).toBeLessThanOrEqual(60_000);
    expect(_getBackoffDelayForTest(SID)).toBe(60_000);
  });

  it("resets backoff when a content-returning dequeue occurs", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Trigger detection → backoff = 5 s
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }
    expect(_getBackoffDelayForTest(SID)).toBe(5_000);

    // Content-returning dequeue → backoff resets to 0
    const evt = makeEvent(1, "content");
    mocks.dequeueBatch.mockReturnValueOnce([evt]);
    await call({ timeout: 0, token: TOKEN });

    expect(_getBackoffDelayForTest(SID)).toBe(0);
  });

  it("applies the backoff sleep before proceeding when backoff is active", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    const sleepCalls: number[] = [];
    _setBackoffSleepForTest((ms) => { sleepCalls.push(ms); return Promise.resolve(); });

    // Trigger detection
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // Next dequeue should invoke the backoff sleep
    await call({ timeout: 0, token: TOKEN });
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);
    expect(sleepCalls[0]).toBe(5_000);
  });
});

// =============================================================================
// Outbound-send exemption (AC4) — notifyDequeueOutboundSend resets throttle
// =============================================================================
describe("outbound-send exemption (AC4 — notifyDequeueOutboundSend)", () => {
  const SID = 88;
  const TOKEN = SID * 1_000_000 + 123_456;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    _resetDequeueThrottleForTest();
    _resetDequeueRateForTest();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
    _setBackoffSleepForTest(() => Promise.resolve());
  });

  afterEach(() => {
    _setBackoffSleepForTest(undefined);
    vi.restoreAllMocks();
  });

  it("resets sub-timeout counter when outbound send is notified", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    // 9 sub-timeout calls — just below threshold
    for (let i = 0; i < 10; i++) {
      if (i > 0) fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    // Simulate outbound send — resets the counter
    notifyDequeueOutboundSend(SID);

    // 9 more sub-timeout calls — counter starts from 0+1=1 and reaches 9 (still below 10)
    for (let i = 0; i < 9; i++) {
      fakeNow += 10_000;
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("DEQUEUE TOO FAST"),
      "behavior_dequeue_sub_timeout",
    );
  });

  it("resets zero-result counter when outbound send is notified", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // 4 empty instant polls
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    // Simulate outbound send — resets the counter
    notifyDequeueOutboundSend(SID);

    // 4 more empty polls — counter was reset, still below threshold
    for (let i = 0; i < 4; i++) {
      await call({ timeout: 0, token: TOKEN });
    }

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.stringContaining("IDLE DEQUEUE LOOP"),
      "behavior_dequeue_zero_result",
    );
  });

  it("clears active backoff when outbound send is notified", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Trigger detection → backoff = 5 s
    for (let i = 0; i < 5; i++) {
      await call({ timeout: 0, token: TOKEN });
    }
    expect(_getBackoffDelayForTest(SID)).toBe(5_000);

    // Outbound send → backoff clears
    notifyDequeueOutboundSend(SID);
    expect(_getBackoffDelayForTest(SID)).toBe(0);
  });

  it("ignores sid <= 0 (defensive guard)", () => {
    // Should not throw, and should not affect any real session state
    expect(() => notifyDequeueOutboundSend(0)).not.toThrow();
    expect(() => notifyDequeueOutboundSend(-1)).not.toThrow();
  });
});
// AC2 + AC3: unexpected subscription close — dequeue injection (10-3029)
// =============================================================================
describe("unexpected subscription close — dequeue injection (10-3029 AC2+AC3)", () => {
  const SID = 42;
  const TOKEN = SID * 1_000_000 + 123_456;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetDequeueRateForTest();
    _resetTimeoutHintForTest();
    _resetActivityFileHintForTest();
    mocks.validateSession.mockReturnValue(true);
    // getSession returns { name: "TestSession" } by default (no parent_sid) — not a child session
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    reminderMocks.popFireableEventReminders.mockReturnValue([]);
    reminderMocks.getSoonestEventReminderMs.mockReturnValue(null);
    reminderMocks.popFireableScheduleReminders.mockReturnValue([]);
    reminderMocks.getSoonestScheduleFireMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
    mocks.checkConnectionToken.mockReturnValue("absent");
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
    // Default: no unexpected close pending
    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValue(false);
  });

  it("AC2: injects SUBSCRIPTION_CLOSED_UNEXPECTEDLY service message when unexpected close is pending", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // Simulate an unexpected SSE or activity-file close
    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValueOnce(true);
    mocks.dequeueBatch.mockReturnValueOnce([]);

    await call({ max_wait: 0, token: TOKEN });

    // deliverServiceMessage should have been called with the bundled entry form
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ eventType: "subscription_closed_unexpectedly" }),
    );
  });

  it("AC2: service message text mentions re-arming the monitor", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValueOnce(true);
    mocks.dequeueBatch.mockReturnValueOnce([]);

    await call({ max_wait: 0, token: TOKEN });

    const [, entry] = mocks.deliverServiceMessage.mock.calls.find(
      ([, e]) => typeof e === "object" && (e as Record<string, string>).eventType === "subscription_closed_unexpectedly",
    ) ?? [];
    expect(entry).toBeDefined();
    expect((entry as Record<string, string>).text).toBeTruthy();
  });

  it("AC3: second dequeue does NOT inject the message again when consume returns false", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    // First dequeue: consumed flag
    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValueOnce(true);
    mocks.dequeueBatch.mockReturnValue([]);

    await call({ max_wait: 0, token: TOKEN });

    const afterFirst = mocks.deliverServiceMessage.mock.calls.filter(
      ([, e]) => typeof e === "object" && (e as Record<string, string>).eventType === "subscription_closed_unexpectedly",
    ).length;
    expect(afterFirst).toBe(1);

    vi.clearAllMocks();
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));
    // consume returns false on second call (already consumed)
    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValue(false);
    mocks.dequeueBatch.mockReturnValue([]);

    await call({ max_wait: 0, token: TOKEN });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ eventType: "subscription_closed_unexpectedly" }),
    );
  });

  it("AC3: no service message when consume returns false (no prior loss event)", async () => {
    const server = createMockServer();
    register(server);
    const call = server.getHandler("dequeue");

    fileStateMocks.consumeUnexpectedSubscriptionClose.mockReturnValue(false);
    mocks.dequeueBatch.mockReturnValue([]);

    await call({ max_wait: 0, token: TOKEN });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ eventType: "subscription_closed_unexpectedly" }),
    );
  });
});
