import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";
import type { TimelineEvent } from "../../message-store.js";
import { runInSessionContext } from "../../session-context.js";
import { delay } from "../../utils/timing.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  routeOutboundMessage: vi.fn(),
  ackVoiceMessage: vi.fn(),
  pinChatMessage: vi.fn(),
  resolveChat: vi.fn((): number => 42),
  pendingCount: vi.fn().mockReturnValue(0),
  _storeQueue: [] as TimelineEvent[],
  _waitResolvers: [] as (() => void)[],
  sessionQueue1: {
    pendingCount: vi.fn(() => 0),
    dequeueMatch: vi.fn((_predicate: (e: TimelineEvent) => unknown) => undefined as unknown),
    waitForEnqueue: vi.fn(() => delay(10)),
  },
  sessionQueue2: {
    pendingCount: vi.fn(() => 0),
    dequeueMatch: vi.fn((_predicate: (e: TimelineEvent) => unknown) => undefined as unknown),
    waitForEnqueue: vi.fn(() => delay(10)),
  },
  peekSessionCategories: vi.fn((_sid: number) => undefined as Record<string, number> | undefined),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage, pinChatMessage: mocks.pinChatMessage }),
    resolveChat: () => mocks.resolveChat(),
    ackVoiceMessage: mocks.ackVoiceMessage,
    routeOutboundMessage: (...args: unknown[]) => mocks.routeOutboundMessage(...args),
  };
});

vi.mock("../../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: () => mocks.pendingCount(),
  dequeueMatch: (predicate: (e: TimelineEvent) => unknown) => {
    for (let i = 0; i < mocks._storeQueue.length; i++) {
      const result = predicate(mocks._storeQueue[i]);
      if (result !== undefined) {
        mocks._storeQueue.splice(i, 1);
        return result;
      }
    }
    return undefined;
  },
  waitForEnqueue: () => new Promise<void>((resolve) => {
    mocks._waitResolvers.push(resolve);
    // Auto-resolve after a tick so tests don't hang forever
    setTimeout(resolve, 10);
  }),
}));

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

vi.mock("../../session-queue.js", () => ({
  getSessionQueue: (sid: number) => {
    if (sid === 1) return mocks.sessionQueue1;
    if (sid === 2) return mocks.sessionQueue2;
    return undefined;
  },
  peekSessionCategories: (sid: number) => mocks.peekSessionCategories(sid),
}));

import { register } from "./ask.js";

const _BASE_MSG = { message_id: 10, chat: { id: 42 }, date: 1000 };

function makeTextEvent(messageId: number, text: string, replyTo?: number): TimelineEvent {
  return {
    id: messageId,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
  };
}

function makeVoiceEvent(messageId: number, text: string, replyTo?: number): TimelineEvent {
  return {
    id: messageId,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "voice", text, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
  };
}

function makeCommandEvent(
  messageId: number,
  command: string,
): TimelineEvent {
  return {
    id: messageId,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "command", text: command },
  };
}

describe("ask tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.pendingCount.mockReturnValue(0);
    mocks.resolveChat.mockReturnValue(42);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.length = 0;
    mocks._waitResolvers.length = 0;
    const server = createMockServer();
    register(server);
    call = server.getHandler("ask");
  });

  it("sends question and returns reply text", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    // Reply must have a higher message_id than the sent question (message_id: 10)
    mocks._storeQueue.push(makeTextEvent(11, "sure"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("sure");
  });

  it("ignores messages with message_id <= sent message_id (stale pre-question messages)", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 }); // sent message_id: 10
    // Stale message with same message_id as the sent question — should be ignored
    mocks._storeQueue.push(makeTextEvent(10, "old voice reply"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    expect((parseResult(result)).timed_out).toBe(true);
  });

  it("returns timed_out when no matching update arrives", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    // Empty queue
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    const data = parseResult(result);
    expect(data.timed_out).toBe(true);
  });

  it("returns voice transcription from pre-transcribed store event", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeVoiceEvent(11, "transcribed text"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("transcribed text");
    expect(data.voice).toBe(true);
  });

  it("sets 🫡 reaction on voice message dequeue", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeVoiceEvent(11, "hello"));
    await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(11);
  });

  it("returns { resolution: 'replied' } when reply_to matches the question message_id", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 }); // sent message_id: 10
    // reply_to: 10 = directly replying to the question
    mocks._storeQueue.push(makeTextEvent(11, "yes I agree", 10));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.resolution).toBe("replied");
    expect(data.text).toBe("yes I agree");
    expect(data.message_id).toBe(11);
    expect(data.timed_out).toBeUndefined();
  });

  it("returns { resolution: 'replied' } for voice reply_to matching question message_id", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 }); // sent message_id: 10
    mocks._storeQueue.push(makeVoiceEvent(11, "spoken reply", 10));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.resolution).toBe("replied");
    expect(data.text).toBe("spoken reply");
    expect(data.timed_out).toBeUndefined();
  });

  it("returns normal text response (not replied) when reply_to does not match", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 }); // sent message_id: 10
    // reply_to: 99 = replying to a different message, not the question
    mocks._storeQueue.push(makeTextEvent(11, "some text", 99));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.resolution).toBeUndefined();
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("some text");
  });

  it("returns normal text response (not replied) when reply_to is absent", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 }); // sent message_id: 10
    mocks._storeQueue.push(makeTextEvent(11, "plain message"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.resolution).toBeUndefined();
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("plain message");
  });

  it("validates question text before sending", async () => {
    const result = await call({ question: "", token: 1_123_456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.routeOutboundMessage).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Issue #4 — commands sent during ask should be returned as break signals
  // =========================================================================

  it("returns command as a break signal instead of ignoring (#4)", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeCommandEvent(11, "cancel"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    const data = parseResult(result);
    // Should not time out — command should be treated as a response
    expect(data.timed_out).toBe(false);
    expect(data.command).toBe("cancel");
    // args is always null on the default format path (null-sentinel contract)
    expect(data.args).toBeNull();
  });

  it("rejects with PENDING_UPDATES when queue is non-empty", async () => {
    mocks.pendingCount.mockReturnValue(5);
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(5);
    expect(mocks.routeOutboundMessage).not.toHaveBeenCalled();
  });

  it("proceeds when ignore_pending is true despite pending updates", async () => {
    mocks.pendingCount.mockReturnValue(5);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeTextEvent(11, "hello"));
    const result = await call({
      question: "Continue?",
      timeout_seconds: 1,
      ignore_pending: true, token: 1_123_456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("hello");
  });

  it("enriches PENDING_UPDATES with breakdown when session queue is available", async () => {
    mocks.getActiveSession.mockReturnValueOnce(1);
    mocks.sessionQueue1.pendingCount.mockReturnValueOnce(4);
    mocks.peekSessionCategories.mockReturnValueOnce({ text: 2, voice: 1, reaction: 1 });
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(4);
    expect(data.breakdown).toEqual({ text: 2, voice: 1, reaction: 1 });
    expect(data.message).toContain("2 text");
    expect(data.message).toContain("1 voice");
    expect(data.message).toContain("ignore_pending: true");
    expect(mocks.routeOutboundMessage).not.toHaveBeenCalled();
  });

  it("bypasses pending guard when reply_to is set", async () => {
    mocks.pendingCount.mockReturnValue(5);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeTextEvent(11, "yes"));
    const result = await call({
      question: "Continue?",
      timeout_seconds: 1,
      reply_to: 99, token: 1_123_456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("yes");
  });

testIdentityGate((args) => call(args), mocks.validateSession, {"question":"x"});

// =========================================================================
// Cross-session isolation
// =========================================================================

describe("response_format: compact", () => {
  it("compact: text reply omits timed_out:false", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeTextEvent(11, "hello"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "compact" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe("hello");
    expect(data.timed_out).toBeUndefined();
  });

  it("compact: voice reply omits timed_out:false and voice:true", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeVoiceEvent(11, "transcribed"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "compact" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe("transcribed");
    expect(data.timed_out).toBeUndefined();
    expect(data.voice).toBeUndefined();
  });

  it("default: text reply includes timed_out:false", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeTextEvent(11, "hello"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "default" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
  });

  it("default: voice reply includes timed_out:false and voice:true", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeVoiceEvent(11, "transcribed"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "default" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.voice).toBe(true);
  });

  it("omitted response_format: voice reply includes timed_out:false and voice:true (backward compat)", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeVoiceEvent(11, "transcribed"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.voice).toBe(true);
  });

  it("compact: command response omits timed_out while command and args are present", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    mocks._storeQueue.push(makeCommandEvent(11, "cancel"));
    const result = await call({ question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "compact" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBeUndefined();
    expect(data.command).toBe("cancel");
    expect("args" in data).toBe(true);
    expect(data.args).toBeNull();
  });

  it("compact: abort (signal abort) omits timed_out:false while aborted:true is present", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    const controller = new AbortController();
    controller.abort();
    const result = await (call as (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>)(
      { question: "Continue?", timeout_seconds: 1, token: 1_123_456, response_format: "compact" },
      { signal: controller.signal },
    );
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBeUndefined();
    expect(data.aborted).toBe(true);
  });
});

describe("cross-session isolation", () => {
  it("session 2 reads from its own queue, not session 1's", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });

    // Session 1 has a text reply in its dedicated queue
    mocks.sessionQueue1.dequeueMatch.mockImplementationOnce(
      (predicate: (e: TimelineEvent) => unknown) => predicate(makeTextEvent(11, "s1 reply")),
    );
    // Session 2 also has a reply in its own queue
    mocks.sessionQueue2.dequeueMatch.mockImplementationOnce(
      (predicate: (e: TimelineEvent) => unknown) => predicate(makeTextEvent(12, "s2 reply")),
    );

    // runInSessionContext(2) sets getCallerSid() to 2 so ask polls from sessionQueue2
    const result = await runInSessionContext(2, () => call({ question: "Continue?", timeout_seconds: 1, token: 2_123_456 }));
    const data = parseResult(result);

    // Got session 2's own event, not session 1's
    expect(data.text).toBe("s2 reply");
    // Session 2's queue was queried
    expect(mocks.sessionQueue2.dequeueMatch).toHaveBeenCalled();
    // Session 1's queue was never touched
    expect(mocks.sessionQueue1.dequeueMatch).not.toHaveBeenCalled();
  });
});

  // ---------------------------------------------------------------------------
  // AC4: ask-mode questions are never pinned (even in group chats)
  // ---------------------------------------------------------------------------

  it("AC4: ask-mode question in group chat does NOT pin the message", async () => {
    // Simulate a group chat (chatId < 0)
    mocks.resolveChat.mockReturnValue(-100123);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 10 });
    // Resolve immediately with a text reply so the tool returns
    mocks._storeQueue.push(makeTextEvent(11, "my reply"));
    mocks.sessionQueue1.dequeueMatch.mockImplementationOnce(
      (predicate: (e: TimelineEvent) => unknown) => predicate(makeTextEvent(11, "my reply")),
    );
    await call({ question: "What do you think?", timeout_seconds: 1, token: 1_123_456 });
    // ask mode must NEVER call pinChatMessage, regardless of chat type
    expect(mocks.pinChatMessage).not.toHaveBeenCalled();
  });

});
