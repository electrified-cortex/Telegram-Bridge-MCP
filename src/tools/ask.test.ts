import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  ackVoiceMessage: vi.fn(),
  _storeQueue: [] as TimelineEvent[],
  _waitResolvers: [] as (() => void)[],
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage }),
    resolveChat: () => 42,
    ackVoiceMessage: mocks.ackVoiceMessage,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
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

import { register } from "./ask.js";

const BASE_MSG = { message_id: 10, chat: { id: 42 }, date: 1000 };

function makeTextEvent(messageId: number, text: string): TimelineEvent {
  return {
    id: messageId,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text },
  };
}

function makeVoiceEvent(messageId: number, text: string): TimelineEvent {
  return {
    id: messageId,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "voice", text },
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
    mocks._storeQueue.length = 0;
    mocks._waitResolvers.length = 0;
    const server = createMockServer();
    register(server);
    call = server.getHandler("ask");
  });

  it("sends question and returns reply text", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    // Reply must have a higher message_id than the sent question (message_id: 10)
    mocks._storeQueue.push(makeTextEvent(11, "sure"));
    const result = await call({ question: "Continue?", timeout_seconds: 1 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("sure");
  });

  it("ignores messages with message_id <= sent message_id (stale pre-question messages)", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG); // sent message_id: 10
    // Stale message with same message_id as the sent question — should be ignored
    mocks._storeQueue.push(makeTextEvent(10, "old voice reply"));
    const result = await call({ question: "Continue?", timeout_seconds: 1 });
    expect((parseResult(result)).timed_out).toBe(true);
  });

  it("returns timed_out when no matching update arrives", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    // Empty queue
    const result = await call({ question: "Continue?", timeout_seconds: 1 });
    const data = parseResult(result);
    expect(data.timed_out).toBe(true);
  });

  it("returns voice transcription from pre-transcribed store event", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks._storeQueue.push(makeVoiceEvent(11, "transcribed text"));
    const result = await call({ question: "Continue?", timeout_seconds: 1 });
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("transcribed text");
    expect(data.voice).toBe(true);
  });

  it("sets 🫡 reaction on voice message dequeue", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks._storeQueue.push(makeVoiceEvent(11, "hello"));
    await call({ question: "Continue?", timeout_seconds: 1 });
    expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(11);
  });

  it("validates question text before sending", async () => {
    const result = await call({ question: "" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Issue #4 — commands sent during ask should be returned as break signals
  // =========================================================================

  it("returns command as a break signal instead of ignoring (#4)", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks._storeQueue.push(makeCommandEvent(11, "cancel"));
    const result = await call({ question: "Continue?", timeout_seconds: 1 });
    const data = parseResult(result);
    // Should not time out — command should be treated as a response
    expect(data.timed_out).toBe(false);
    expect(data.command).toBe("cancel");
  });
});
