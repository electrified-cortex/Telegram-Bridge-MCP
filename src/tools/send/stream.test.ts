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

import { handleStreamStart, handleStreamChunk, handleStreamFlush, _resetStreamsForTest } from "./stream.js";

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
});
