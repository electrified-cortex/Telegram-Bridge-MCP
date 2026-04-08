import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => true),
  sendMessage: vi.fn(),
  sendVoiceDirect: vi.fn(),
  resolveChat: vi.fn((): number => 42),
  validateText: vi.fn((): null => null),
  isTtsEnabled: vi.fn((): boolean => true),
  stripForTts: vi.fn((t: string) => t),
  synthesizeToOgg: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
  getTopic: vi.fn((): string | null => null),
  showTyping: vi.fn(),
  cancelTyping: vi.fn(),
  getSessionVoice: vi.fn((): string | null => null),
  getSessionSpeed: vi.fn((): number | null => null),
  splitMessage: vi.fn((t: string) => [t]),
  markdownToV2: vi.fn((t: string) => t),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
    }),
    resolveChat: () => mocks.resolveChat(),
    validateText: (t: string) => mocks.validateText(t),
    sendVoiceDirect: (...args: unknown[]) => mocks.sendVoiceDirect(...args),
    splitMessage: (t: string) => mocks.splitMessage(t),
    callApi: (fn: () => unknown) => fn(),
  };
});

vi.mock("../markdown.js", () => ({
  markdownToV2: (t: string) => mocks.markdownToV2(t),
}));

vi.mock("../topic-state.js", () => ({
  applyTopicToText: (t: string, mode?: string) => mocks.applyTopicToText(t, mode),
  getTopic: () => mocks.getTopic(),
}));

vi.mock("../tts.js", () => ({
  isTtsEnabled: () => mocks.isTtsEnabled(),
  stripForTts: (t: string) => mocks.stripForTts(t),
  synthesizeToOgg: (...args: unknown[]) => mocks.synthesizeToOgg(...args),
}));

vi.mock("../typing-state.js", () => ({
  showTyping: (...args: unknown[]) => mocks.showTyping(...args),
  cancelTyping: () => mocks.cancelTyping(),
}));

vi.mock("../voice-state.js", () => ({
  getSessionVoice: () => mocks.getSessionVoice(),
  getSessionSpeed: () => mocks.getSessionSpeed(),
}));

vi.mock("../config.js", () => ({
  getDefaultVoice: () => undefined,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (sid: number, pin: number) => mocks.validateSession(sid, pin),
}));

import { register } from "./send.js";

const TOKEN = 1_123_456; // sid=1, pin=123456
const SENT_MSG = { message_id: 42 };
const SENT_VOICE_MSG = { message_id: 43 };

const TABLE_WARNING =
  "Message sent. Note: markdown tables were detected but not formatted — Telegram does not support table rendering.";

describe("send tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveChat.mockReturnValue(42);
    mocks.validateText.mockReturnValue(null);
    mocks.isTtsEnabled.mockReturnValue(true);
    mocks.stripForTts.mockImplementation((t: string) => t);
    mocks.applyTopicToText.mockImplementation((t: string) => t);
    mocks.markdownToV2.mockImplementation((t: string) => t);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.sendVoiceDirect.mockResolvedValue(SENT_VOICE_MSG);
    mocks.showTyping.mockResolvedValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  // ---------------------------------------------------------------------------
  // Case 1: text-only
  // ---------------------------------------------------------------------------
  it("text-only: sends text message and returns message_id", async () => {
    const result = await call({ text: "hello world", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.audio).toBeUndefined();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Case 2: voice-only (string)
  // ---------------------------------------------------------------------------
  it("voice-only (string): calls TTS and sends voice note", async () => {
    const result = await call({ audio: "nova", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    expect(data.audio).toBe(true);
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Case 3: audio-only (no voice override — uses session/default)
  // ---------------------------------------------------------------------------
  it("audio-only: calls TTS with session voice (or undefined if none set)", async () => {
    const result = await call({ audio: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    expect(data.audio).toBe(true);
    expect(mocks.synthesizeToOgg).toHaveBeenCalledWith("hello", undefined, undefined);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Case 4: combined mode (text + voice)
  // ---------------------------------------------------------------------------
  it("combined mode: sends voice note with text as caption", async () => {
    const result = await call({ text: "caption text", audio: "shimmer", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    expect(data.audio).toBe(true);
    // Voice was sent (not text message)
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    // Caption was passed to sendVoiceDirect
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Case 5: MISSING_CONTENT
  // ---------------------------------------------------------------------------
  it("MISSING_CONTENT: neither text nor voice returns error", async () => {
    const result = await call({ token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_CONTENT");
  });

  // ---------------------------------------------------------------------------
  // Case 6: TTS_NOT_CONFIGURED
  // ---------------------------------------------------------------------------
  it("TTS_NOT_CONFIGURED: voice provided but TTS disabled returns error", async () => {
    mocks.isTtsEnabled.mockReturnValue(false);
    const result = await call({ audio: "nova", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("TTS_NOT_CONFIGURED");
  });

  // ---------------------------------------------------------------------------
  // Case 7: table warning
  // ---------------------------------------------------------------------------
  it("table warning: text containing markdown table returns info field", async () => {
    const tableText = "| A | B |\n| - | - |\n| 1 | 2 |";
    const result = await call({ text: tableText, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.info).toBe(TABLE_WARNING);
  });

  // ---------------------------------------------------------------------------
  // Auth gate
  // ---------------------------------------------------------------------------
  it("returns SID_REQUIRED when token is missing", async () => {
    const result = await call({ text: "hello" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when token has wrong pin", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ text: "hello", token: 1_099_999 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  // ---------------------------------------------------------------------------
  // Case 9: combined mode — caption truncation
  // ---------------------------------------------------------------------------
  it("combined mode: truncates caption and returns info when text exceeds 964 chars", async () => {
    const longText = "A".repeat(965); // 965 chars > MAX_CAPTION (964)
    // applyTopicToText returns the text as-is (mock default)
    const result = await call({ text: longText, audio: "nova", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Voice note was sent
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    // Result is success
    expect(data.audio).toBe(true);
    // Caption truncation info is present
    expect(data.info).toBe("Caption was truncated to fit Telegram's 1024-character limit.");
  });
});
