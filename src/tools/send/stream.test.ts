import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../../telegram.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  getMessage: vi.fn(),
  recordOutgoing: vi.fn(),
  recordOutgoingEdit: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 42),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../../message-store.js", () => ({
  getMessage: mocks.getMessage,
  recordOutgoing: mocks.recordOutgoing,
  recordOutgoingEdit: mocks.recordOutgoingEdit,
  CURRENT: -1,
}));

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: mocks.validateSession,
}));

import { handleStreamStart, handleStreamChunk, handleStreamFlush, _resetStreamsForTest, _getStreamTimeoutMsForTest } from "./stream.js";

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

function isError(result: unknown): boolean {
  return !!(result as { isError?: boolean }).isError;
}

function errorCode(result: unknown): string {
  return (parseResult(result) as { code: string }).code;
}

describe("stream/start handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    _resetStreamsForTest();
  });

  it("creates a message and returns message_id and stream_id", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 101 });
    const result = await handleStreamStart({ token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as { message_id: number; stream_id: string };
    expect(data.message_id).toBe(101);
    expect(typeof data.stream_id).toBe("string");
    expect(data.stream_id.length).toBeGreaterThan(0);
  });

  it("uses placeholder text when no text provided", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 102 });
    await handleStreamStart({ token: 1_123_456 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String), // resolved placeholder (may be MarkdownV2-escaped)
      expect.any(Object),
    );
    expect(mocks.recordOutgoing).toHaveBeenCalledWith(102, "text", "⏳ ...");
  });

  it("uses provided initial text when given", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 103 });
    await handleStreamStart({ text: "Starting...", token: 1_123_456 });
    expect(mocks.recordOutgoing).toHaveBeenCalledWith(103, "text", "Starting...");
  });

  it("returns error on sendMessage failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 429, description: "Too Many Requests" }, "sendMessage", {}),
    );
    const result = await handleStreamStart({ token: 1_123_456 });
    expect(isError(result)).toBe(true);
  });
});

describe("stream/chunk handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    _resetStreamsForTest();
  });

  it("appends text to the stream message", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 200 });
    mocks.editMessageText.mockResolvedValue({ message_id: 200 });
    // start a stream
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // stub current message text to placeholder
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "⏳ ..." } });

    const result = await handleStreamChunk({ stream_id, text: "Hello world", token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as { message_id: number; length: number };
    expect(data.message_id).toBe(200);
    expect(data.length).toBe("Hello world".length);
    // chunk replaces placeholder, so accumulated = "Hello world"
    expect(mocks.recordOutgoingEdit).toHaveBeenCalledWith(200, "text", "Hello world");
  });

  it("accumulates chunks when prior text exists", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 201 });
    mocks.editMessageText.mockResolvedValue({ message_id: 201 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Hello" } });
    const result = await handleStreamChunk({ stream_id, text: " world", separator: "", token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as { message_id: number; length: number };
    expect(data.length).toBe("Hello world".length);
  });

  it("returns STREAM_NOT_FOUND for unknown stream_id", async () => {
    const result = await handleStreamChunk({
      stream_id: "00000000-0000-0000-0000-000000000000",
      text: "chunk",
      token: 1_123_456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_NOT_FOUND");
  });

  it("returns STREAM_FORBIDDEN when sid mismatches", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 202 });
    // start with sid 1
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // attempt chunk with different sid (token encodes sid 2)
    const result = await handleStreamChunk({ stream_id, text: "hack", token: 2_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_FORBIDDEN");
  });

  it("returns RATE_LIMITED with retryAfterMs on 429", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockResolvedValue({ message_id: 210 });
    mocks.editMessageText.mockRejectedValue(
      new GrammyError(
        "Too Many Requests: retry after 30",
        { ok: false, error_code: 429, description: "Too Many Requests: retry after 30", parameters: { retry_after: 30 } },
        "editMessageText",
        {},
      ),
    );
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "⏳ ..." } });

    const result = await handleStreamChunk({ stream_id, text: "chunk", token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("RATE_LIMITED");
    const data = parseResult(result) as { retryAfterMs: number };
    expect(data.retryAfterMs).toBe(30_000);
  });

  it("returns RATE_LIMITED with default retryAfterMs when retry_after is missing", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockResolvedValue({ message_id: 211 });
    mocks.editMessageText.mockRejectedValue(
      new GrammyError(
        "Too Many Requests",
        { ok: false, error_code: 429, description: "Too Many Requests" },
        "editMessageText",
        {},
      ),
    );
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "⏳ ..." } });

    const result = await handleStreamChunk({ stream_id, text: "chunk", token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("RATE_LIMITED");
    // Default is 5 seconds
    const data = parseResult(result) as { retryAfterMs: number };
    expect(data.retryAfterMs).toBe(5_000);
  });

  it("returns STREAM_OVERFLOW when accumulated text exceeds 4096 chars", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 220 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // Simulate existing text that's already near the limit
    const nearLimitText = "x".repeat(4090);
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: nearLimitText } });

    const result = await handleStreamChunk({ stream_id, text: "overflow chunk", token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_OVERFLOW");
    const data = parseResult(result) as { currentLength: number; maxLength: number };
    expect(data.currentLength).toBe(nearLimitText.length + "overflow chunk".length);
    expect(data.maxLength).toBe(4096);
    // Should not have called editMessageText
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("returns STREAM_OVERFLOW when accumulated text equals 4097 chars", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 221 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // 4096 existing chars + 1 new = 4097, should overflow
    const maxText = "y".repeat(4096);
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: maxText } });

    const result = await handleStreamChunk({ stream_id, text: "!", token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_OVERFLOW");
  });

  it("allows chunk that exactly fills 4096 chars", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 222 });
    mocks.editMessageText.mockResolvedValue({ message_id: 222 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    const existingText = "z".repeat(4090);
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: existingText } });

    const result = await handleStreamChunk({ stream_id, text: "z".repeat(6), token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as { length: number };
    expect(data.length).toBe(4096);
  });

  it("returns STREAM_EXPIRED after timeout", async () => {
    vi.useFakeTimers();
    mocks.sendMessage.mockResolvedValue({ message_id: 230 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // Advance time past the stream timeout
    vi.advanceTimersByTime(_getStreamTimeoutMsForTest() + 1);

    const result = await handleStreamChunk({ stream_id, text: "too late", token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_EXPIRED");

    vi.useRealTimers();
  });
});

describe("stream/flush handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    _resetStreamsForTest();
  });

  it("removes stream from state and returns final_length", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 300 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Final content here" } });
    const result = handleStreamFlush({ stream_id, token: 1_123_456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as { message_id: number; final_length: number; status: string };
    expect(data.message_id).toBe(300);
    expect(data.final_length).toBe("Final content here".length);
    expect(data.status).toBe("flushed");
  });

  it("returns STREAM_NOT_FOUND after stream is already flushed", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 301 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "done" } });
    handleStreamFlush({ stream_id, token: 1_123_456 });

    // second flush should fail
    const result2 = handleStreamFlush({ stream_id, token: 1_123_456 });
    expect(isError(result2)).toBe(true);
    expect(errorCode(result2)).toBe("STREAM_NOT_FOUND");
  });

  it("returns STREAM_NOT_FOUND for unknown stream_id", () => {
    const result = handleStreamFlush({
      stream_id: "nonexistent-id",
      token: 1_123_456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_NOT_FOUND");
  });

  it("returns STREAM_EXPIRED when flushing an expired stream", async () => {
    vi.useFakeTimers();
    mocks.sendMessage.mockResolvedValue({ message_id: 310 });
    const startResult = await handleStreamStart({ token: 1_123_456 });
    const { stream_id } = parseResult(startResult) as { message_id: number; stream_id: string };

    // Advance time past the timeout
    vi.advanceTimersByTime(_getStreamTimeoutMsForTest() + 1);

    const result = handleStreamFlush({ stream_id, token: 1_123_456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("STREAM_EXPIRED");

    vi.useRealTimers();
  });
});
