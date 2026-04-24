import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
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
  empty?: boolean;
  hint?: string;
}

interface SessionQueue {
  dequeueBatch: (...args: unknown[]) => TimelineEvent[];
  pendingCount: (...args: unknown[]) => number;
  waitForEnqueue: (...args: unknown[]) => Promise<unknown>;
}

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
  setDequeueIdle: vi.fn(),
  isTutorialEnabled: vi.fn(() => false),
  markTutorialToolSeen: vi.fn(() => false),
  getSession: vi.fn(() => ({ name: "TestSession" })),
  takeSilenceHint: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => mocks.getSessionQueue(sid),
  getMessageOwner: (msgId: number) => mocks.getMessageOwner(msgId),
  peekSessionCategories: (sid: number) => mocks.peekSessionCategories(sid),
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
  buildReminderEvent: (r: unknown) => reminderMocks.buildReminderEvent(r),
}));





import { register, _resetTimeoutHintForTest, _resetFirstDequeueHintForTest } from "./dequeue.js";

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

function makeVoiceEvent(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "voice", text: "hello", file_id: "f1", duration: 2 } as never,
    _update: { update_id: id } as never,
  };
}

describe("dequeue tool", () => {
  let call: (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetTimeoutHintForTest();
    mocks.validateSession.mockReturnValue(true);
    reminderMocks.getActiveReminders.mockReturnValue([]);
    reminderMocks.popActiveReminders.mockReturnValue([]);
    reminderMocks.getSoonestDeferredMs.mockReturnValue(null);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.peekSessionCategories.mockReturnValue(undefined);
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

  it("returns empty when queue is empty and timeout is 0 (instant poll)", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    const result = await call({ timeout: 0, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<DequeueResult>(result);
    expect(data.empty).toBe(true);
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
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await call({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.timed_out).toBe(true);
    expect(data.pending).toBe(0);
  });

  it("calls waitForEnqueue when queue is empty and timeout > 0", async () => {
    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
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
      () => new Promise<void>((r) => setTimeout(r, 50)),
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
    expect(data.empty).toBe(true);
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
    const text = JSON.stringify(result);
    expect(text).toContain("SID_REQUIRED");
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
      const text = JSON.stringify(result);
      expect(text).toContain("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when suffix does not match", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ token: 3_009_999, timeout: 0 });
      expect(isError(result)).toBe(true);
      const text = JSON.stringify(result);
      expect(text).toContain("AUTH_FAILED");
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
        _update: { update_id: id } as never,
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
        _update: { update_id: 11 } as never,
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
        () => new Promise<void>((r) => setTimeout(r, 50)),
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
        () => new Promise<void>((r) => setTimeout(r, 50)),
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
        () => new Promise<void>((r) => setTimeout(r, 50)),
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
        () => new Promise<void>((r) => setTimeout(r, 50)),
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
        () => new Promise<void>((r) => setTimeout(r, 50)),
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
      expect(data.empty).toBe(true);
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
      expect(data.empty).toBe(true);
    });

    it("max_wait takes precedence over timeout alias when both provided", async () => {
      // max_wait: 0 → instant poll; timeout: 300 → long block. max_wait wins.
      mocks.dequeueBatch.mockReturnValue([]);
      const result = await call({ max_wait: 0, timeout: 300, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.empty).toBe(true);
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
        (fn: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (typeof delay === "number") capturedDelays.push(delay);
          return originalSetTimeout(fn as () => void, 0, ...args);
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
      expect(data.empty).toBe(true);
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
      expect(data.hint).toContain("2 voice msg pending");
      expect(data.hint).toContain("processing preset");
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

    it("does not include hint when batch is text-only even if pending voice exists", async () => {
      const evt = makeEvent(103, "text only");
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(1);
      mocks.peekSessionCategories.mockReturnValue({ voice: 3 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeUndefined();
    });

    it("does not include hint when batch has voice but only text is pending (no voice key)", async () => {
      const evt = makeVoiceEvent(104);
      mocks.dequeueBatch.mockReturnValueOnce([evt]);
      mocks.pendingCount.mockReturnValue(2);
      // peekSessionCategories returns text but no voice
      mocks.peekSessionCategories.mockReturnValue({ text: 2 });
      const result = await call({ timeout: 0, token: 1_123_456 });
      const data = parseResult<DequeueResult>(result);
      expect(data.hint).toBeUndefined();
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
      expect(data1.hint).toContain("1 voice msg pending");

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
  // Reminder fire path — tokenHint propagation
  // =========================================================================

  describe("reminder fire path", () => {
    it("fires reminder events and returns updates with no hint fields", async () => {
      // Strategy: mock Date.now so that idleDuration immediately exceeds
      // REMINDER_IDLE_THRESHOLD_MS (60_000 ms) on the first loop iteration.
      // This lets us test the reminder-fire return path without real delays
      // or fake timers (which cause V8 heap issues in this test runner).
      const realDateNow = Date.now;
      const fakeStart = realDateNow();
      let dateNowCallCount = 0;
      Date.now = () => {
        // Calls in dequeue.ts (in order):
        //   0: deadline = Date.now() + timeout * 1000   → fakeStart (normal)
        //   1: reminderIdleStart = Date.now()           → fakeStart (normal)
        //   2: while (Date.now() < deadline)            → fakeStart (enters loop)
        //   3: const now = Date.now()                   → fakeStart + 61_000 (idleDuration >= threshold)
        const callIdx = dateNowCallCount++;
        return callIdx < 3 ? fakeStart : fakeStart + 61_000;
      };

      try {
        const fakeReminder = { id: "rem-1", text: "test reminder", recurring: false, delay_seconds: 0, created_at: fakeStart, activated_at: fakeStart, state: "active" as const };
        reminderMocks.getActiveReminders.mockReturnValue([fakeReminder]);
        reminderMocks.popActiveReminders.mockReturnValue([fakeReminder]);

        const result = await call({ timeout: 300, token: 1_123_456 });
        const data = parseResult(result);

        // The reminder-fire path should have fired
        expect(data.updates).toBeDefined();
        expect(Array.isArray(data.updates)).toBe(true);
        // No hint field in lean response
        expect(data.hint).toBeUndefined();
      } finally {
        Date.now = realDateNow;
      }
    });
  });
});
