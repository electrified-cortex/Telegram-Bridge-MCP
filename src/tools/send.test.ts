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
  typingGeneration: vi.fn(() => 0),
  cancelTypingIfSameGeneration: vi.fn(),
  getSessionVoice: vi.fn((): string | null => null),
  getSessionSpeed: vi.fn((): number | null => null),
  splitMessage: vi.fn((t: string) => [t]),
  markdownToV2: vi.fn((t: string) => t),
  handleShowAnimation: vi.fn(),
  handleSendNewProgress: vi.fn(),
  handleSendDirectMessage: vi.fn(),
  handleConfirm: vi.fn(),
  handleAppendText: vi.fn(),
  handleSendChoice: vi.fn(),
  handleSendNewChecklist: vi.fn(),
  handleAsk: vi.fn(),
  handleChoose: vi.fn(),
  deliverServiceMessage: vi.fn(),
  getFirstUseHint: vi.fn((): string | null => null),
  markFirstUseHintSeen: vi.fn((): boolean => false),
  enqueueAsyncSend: vi.fn(() => -1_000_000_001),
  resetAsyncSendQueueForTest: vi.fn(),
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
  typingGeneration: () => mocks.typingGeneration(),
  cancelTypingIfSameGeneration: (...args: unknown[]) => mocks.cancelTypingIfSameGeneration(...args),
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
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
}));

vi.mock("./show_animation.js", () => ({
  handleShowAnimation: (args: unknown) => mocks.handleShowAnimation(args),
}));

vi.mock("./send_new_progress.js", () => ({
  handleSendNewProgress: (args: unknown) => mocks.handleSendNewProgress(args),
}));

vi.mock("./send_direct_message.js", () => ({
  handleSendDirectMessage: (args: unknown) => mocks.handleSendDirectMessage(args),
}));

vi.mock("./confirm.js", () => ({
  handleConfirm: (args: unknown) => mocks.handleConfirm(args),
}));

vi.mock("./append_text.js", () => ({
  handleAppendText: (args: unknown) => mocks.handleAppendText(args),
}));

vi.mock("../session-queue.js", () => ({
  deliverServiceMessage: (...args: unknown[]) => mocks.deliverServiceMessage(...args),
}));

vi.mock("../async-send-queue.js", () => ({
  enqueueAsyncSend: (...args: unknown[]) => mocks.enqueueAsyncSend(...args),
  resetAsyncSendQueueForTest: () => mocks.resetAsyncSendQueueForTest(),
}));

vi.mock("../first-use-hints.js", () => ({
  getFirstUseHint: (...args: unknown[]) => mocks.getFirstUseHint(...args),
  markFirstUseHintSeen: (...args: unknown[]) => mocks.markFirstUseHintSeen(...args),
  appendHintToResult: <T extends { content: { type: string; text: string }[]; isError?: true }>(result: T, hint: string | null): T => {
    if (!hint || result.isError) return result;
    try {
      const entry = result.content[0];
      if (entry.type !== "text") return result;
      const parsed = JSON.parse(entry.text) as Record<string, unknown>;
      parsed._first_use_hint = hint;
      entry.text = JSON.stringify(parsed);
    } catch {
      // no-op
    }
    return result;
  },
}));

vi.mock("./send_choice.js", () => ({
  handleSendChoice: (args: unknown) => mocks.handleSendChoice(args),
}));

vi.mock("./send_new_checklist.js", () => ({
  handleSendNewChecklist: (args: unknown) => mocks.handleSendNewChecklist(args),
}));

vi.mock("./ask.js", () => ({
  handleAsk: (args: unknown, signal: unknown) => mocks.handleAsk(args, signal),
}));

vi.mock("./choose.js", () => ({
  handleChoose: (args: unknown, signal: unknown) => mocks.handleChoose(args, signal),
}));

import { register } from "./send.js";

const TOKEN = 1_123_456; // sid=1, suffix=123456
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
    mocks.deliverServiceMessage.mockReturnValue(undefined);

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
    const result = await call({ audio: "nova", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Case 3: audio-only (no voice override — uses session/default)
  // ---------------------------------------------------------------------------
  it("audio-only: calls TTS with session voice (or undefined if none set)", async () => {
    const result = await call({ audio: "hello", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    expect(mocks.synthesizeToOgg).toHaveBeenCalledWith("hello", undefined, undefined);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Case 4: combined mode (text + voice)
  // ---------------------------------------------------------------------------
  it("combined mode: sends voice note with text as caption", async () => {
    const result = await call({ text: "caption text", audio: "shimmer", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(43);
    // Voice was sent (not text message)
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    // Caption was passed to sendVoiceDirect
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Case 5: discovery mode (no args) → returns available types
  // ---------------------------------------------------------------------------
  it("discovery mode: no args returns available types list", async () => {
    const result = await call({ token: TOKEN });
    expect(isError(result)).toBe(false);
    const content = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(content) as { available_types: string[] };
    expect(data.available_types).toContain("text");
    expect(data.available_types).toContain("file");
    expect(data.available_types).toContain("question");
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

  it("returns AUTH_FAILED when token has wrong suffix", async () => {
    mocks.validateSession.mockReturnValue(false);
    const result = await call({ text: "hello", token: 1_099_999 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  // ---------------------------------------------------------------------------
  // Case 9: combined mode — caption overflow auto-split
  // ---------------------------------------------------------------------------
  it("combined mode: auto-splits into two messages when text exceeds 964 chars", async () => {
    const longText = "A".repeat(965); // 965 chars > MAX_CAPTION (964)
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    const result = await call({ text: longText, audio: "nova", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Voice note was sent (no caption)
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    // Text message was sent separately
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    // Result has split + both IDs
    expect(data.split).toBe(true);
    expect(data.message_id).toBe(43);
    expect(data.text_message_id).toBe(99);
    // Voice note sent with no caption
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Case 10: combined mode — no split when text is under limit
  // ---------------------------------------------------------------------------
  it("combined mode: no split when text is under 964 chars (single hybrid message)", async () => {
    const shortText = "A".repeat(963); // under MAX_CAPTION (964)
    const result = await call({ text: shortText, audio: "nova", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Voice note sent with caption
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(data.split).toBeUndefined();
    expect(data.text_message_id).toBeUndefined();
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Case 11: voice mode — validateText called per-chunk, not pre-split
  // ---------------------------------------------------------------------------
  it("voice mode: returns error for invalid chunk without partial delivery", async () => {
    mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
    // First chunk passes, second chunk fails validation
    mocks.validateText
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ code: "MESSAGE_TOO_LONG", message: "chunk too long" });
    const result = await call({ audio: "hello world", async: false, token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
    // No synthesis or delivery — validation runs before the send loop
    expect(mocks.synthesizeToOgg).not.toHaveBeenCalled();
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Gap 1: voice chunk partial failure — synthesizeToOgg fails mid-sequence
  // ---------------------------------------------------------------------------
  it("voice chunk partial failure: error returned when TTS fails on second chunk", async () => {
    mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
    // Both chunks pass pre-send validation
    mocks.validateText.mockReturnValue(null);
    // First chunk synthesizes OK, second throws mid-sequence
    mocks.synthesizeToOgg
      .mockResolvedValueOnce(Buffer.from("ogg-chunk1"))
      .mockRejectedValueOnce(new Error("TTS upstream failure"));
    // First sendVoiceDirect call succeeds
    mocks.sendVoiceDirect.mockResolvedValueOnce({ message_id: 43 });

    const result = await call({ audio: "hello world chunk test", async: false, token: TOKEN });

    expect(isError(result)).toBe(true);
    // First chunk was already sent; error propagates from the second
    expect(mocks.synthesizeToOgg).toHaveBeenCalledTimes(2);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledTimes(1);
    // cancelTypingIfSameGeneration cleanup must still run (finally block)
    expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Gap 2: VOICE_RESTRICTED — sendVoiceDirect throws privacy restriction error
  // ---------------------------------------------------------------------------
  it("VOICE_RESTRICTED: returns correct error when Telegram blocks voice due to privacy settings", async () => {
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
    mocks.sendVoiceDirect.mockRejectedValue(
      new Error("user restricted receiving of voice note messages"),
    );

    const result = await call({ audio: "say something", async: false, token: TOKEN });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("VOICE_RESTRICTED");
    // cancelTypingIfSameGeneration cleanup must still run (finally block)
    expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Async path tests
  // ---------------------------------------------------------------------------

  it("async TTS: send(type: text, audio, async: true) returns queued response immediately", async () => {
    mocks.enqueueAsyncSend.mockReturnValue(-1_000_000_001);
    const result = await call({ type: "text", audio: "hello async", async: true, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.message_id_pending).toBe(-1_000_000_001);
    expect(data.status).toBe("queued");
  });

  it("async TTS: enqueueAsyncSend is called instead of synchronous TTS path", async () => {
    mocks.enqueueAsyncSend.mockReturnValue(-1_000_000_001);
    await call({ type: "text", audio: "hello async", async: true, token: TOKEN });
    expect(mocks.enqueueAsyncSend).toHaveBeenCalledOnce();
    expect(mocks.synthesizeToOgg).not.toHaveBeenCalled();
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  it("async: false — synchronous TTS path is used (enqueueAsyncSend not called)", async () => {
    await call({ audio: "hello sync", async: false, token: TOKEN });
    expect(mocks.enqueueAsyncSend).not.toHaveBeenCalled();
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
  });

  it("async omitted — async TTS path is used by default (enqueueAsyncSend called)", async () => {
    mocks.enqueueAsyncSend.mockReturnValue(-1_000_000_001);
    const result = await call({ audio: "hello no async flag", token: TOKEN });
    expect(mocks.enqueueAsyncSend).toHaveBeenCalledOnce();
    expect(mocks.synthesizeToOgg).not.toHaveBeenCalled();
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.message_id_pending).toBe(-1_000_000_001);
    expect(parsed.status).toBe("queued");
  });
});

// =============================================================================
// 10-508: message alias tests
// =============================================================================
describe("send — message alias", () => {
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

  it("message alias: send(message: 'hello') succeeds and returns message_id (no hint field)", async () => {
    const result = await call({ message: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeUndefined();
  });

  it("message alias: send(text: 'hello', message: 'world') uses text (no hint)", async () => {
    const result = await call({ text: "hello", message: "world", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeUndefined();
    // Confirm text wins — applyTopicToText was called with "hello" not "world"
    expect(mocks.applyTopicToText).toHaveBeenCalledWith("hello", expect.anything());
  });

  it("message alias: send(message: 'hello', audio: 'spoken') works — voice with caption alias (no hint)", async () => {
    const result = await call({ message: "caption via alias", audio: "spoken content", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
  });

  it("canonical text still works normally (no hint)", async () => {
    const result = await call({ text: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeUndefined();
  });
});

// =============================================================================
// Type routing tests
// =============================================================================
describe("send type routing", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveChat.mockReturnValue(42);
    mocks.validateText.mockReturnValue(null);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.markdownToV2.mockImplementation((t: string) => t);
    mocks.applyTopicToText.mockImplementation((t: string) => t);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  it("no args → discovery mode returns available_types", async () => {
    const result = await call({ token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ available_types: string[] }>(result);
    expect(Array.isArray(data.available_types)).toBe(true);
    expect(data.available_types).toContain("text");
    expect(data.available_types).toContain("file");
    expect(data.available_types).toContain("question");
  });

  it("type: text routes to text mode", async () => {
    const result = await call({ type: "text", text: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
  });

  it("type: text with no text or audio returns MISSING_CONTENT", async () => {
    const result = await call({ type: "text", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_CONTENT");
  });

  it("type: file without file param returns MISSING_PARAM", async () => {
    const result = await call({ type: "file", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: notification without title returns MISSING_PARAM", async () => {
    const result = await call({ type: "notification", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: choice without text returns MISSING_PARAM", async () => {
    const result = await call({
      type: "choice",
      options: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: dm without target_sid returns MISSING_PARAM", async () => {
    const result = await call({ type: "dm", text: "hi", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: direct without target_sid returns MISSING_PARAM (backward-compat alias)", async () => {
    const result = await call({ type: "direct", text: "hi", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it('type: "dm" without text returns MISSING_PARAM', async () => {
    const result = await call({ type: "dm", target_sid: 99, token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it('type: "dm" with target_sid and text succeeds (happy path)', async () => {
    mocks.handleSendDirectMessage.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    const result = await call({ type: "dm", target_sid: 99, text: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendDirectMessage).toHaveBeenCalledOnce();
  });

  it('type: "dm" with target alias sends successfully', async () => {
    mocks.handleSendDirectMessage.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    const result = await call({ type: "dm", target: 99, text: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendDirectMessage).toHaveBeenCalledOnce();
    const called = mocks.handleSendDirectMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(called.target_sid).toBe(99);
  });

  it('type: "dm" with matching target and target_sid succeeds', async () => {
    mocks.handleSendDirectMessage.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    const result = await call({ type: "dm", target_sid: 99, target: 99, text: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendDirectMessage).toHaveBeenCalledOnce();
  });

  it('type: "dm" with conflicting target and target_sid returns CONFLICT error', async () => {
    const result = await call({ type: "dm", target_sid: 99, target: 77, text: "hello", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CONFLICT");
  });

  it("type: append without message_id returns MISSING_PARAM", async () => {
    const result = await call({ type: "append", text: "more", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: append without text returns MISSING_PARAM", async () => {
    const result = await call({ type: "append", message_id: 10, token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: append routes to handleAppendText with correct params", async () => {
    mocks.handleAppendText.mockResolvedValue({ content: [{ type: "text", text: '{"message_id":10}' }] });
    const result = await call({ type: "append", message_id: 10, text: "hello", separator: " | ", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.handleAppendText).toHaveBeenCalledOnce();
    const called = mocks.handleAppendText.mock.calls[0][0] as Record<string, unknown>;
    expect(called.message_id).toBe(10);
    expect(called.text).toBe("hello");
    expect(called.separator).toBe(" | ");
    expect(called.parse_mode).toBe("Markdown");
  });

  it("type: checklist without title returns MISSING_PARAM", async () => {
    const result = await call({
      type: "checklist",
      steps: [{ label: "Step 1", status: "pending" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: progress without percent returns MISSING_PARAM", async () => {
    const result = await call({ type: "progress", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_PARAM");
  });

  it("type: question without sub-type returns MISSING_QUESTION_TYPE", async () => {
    const result = await call({ type: "question", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_QUESTION_TYPE");
  });

  // ---------------------------------------------------------------------------
  // 10-463 regression: confirm yes_style defaults to "primary"
  // ---------------------------------------------------------------------------
  it('type: question/confirm — yes_style defaults to "primary" when not provided', async () => {
    mocks.handleConfirm.mockResolvedValue({ content: [{ type: "text", text: '{"answer":"yes"}' }] });
    await call({ type: "question", confirm: "Are you sure?", token: TOKEN });
    expect(mocks.handleConfirm).toHaveBeenCalledOnce();
    const called = mocks.handleConfirm.mock.calls[0][0] as Record<string, unknown>;
    expect(called.yes_style).toBe("primary");
  });

  // ---------------------------------------------------------------------------
  // 10-423 regression: animation timeout routing
  // ---------------------------------------------------------------------------
  it("type: animation — routes timeout param to handleShowAnimation (not silently dropped)", async () => {
    mocks.handleShowAnimation.mockResolvedValue({ content: [{ type: "text", text: '{"message_id":99}' }] });
    await call({ type: "animation", preset: "working", timeout: 5, token: TOKEN });
    expect(mocks.handleShowAnimation).toHaveBeenCalledOnce();
    const called = mocks.handleShowAnimation.mock.calls[0][0] as Record<string, unknown>;
    expect(called.timeout).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // 10-430 regression: progress/checklist text alias for title caption
  // ---------------------------------------------------------------------------
  it("type: progress — text param used as title caption when title omitted", async () => {
    mocks.handleSendNewProgress.mockResolvedValue({ content: [{ type: "text", text: '{"message_id":55}' }] });
    await call({ type: "progress", text: "Running tests", percent: 42, token: TOKEN });
    expect(mocks.handleSendNewProgress).toHaveBeenCalledOnce();
    const called = mocks.handleSendNewProgress.mock.calls[0][0] as Record<string, unknown>;
    expect(called.title).toBe("Running tests");
    expect(called.percent).toBe(42);
  });

  it("type: progress — explicit title takes precedence over text", async () => {
    mocks.handleSendNewProgress.mockResolvedValue({ content: [{ type: "text", text: '{"message_id":56}' }] });
    await call({ type: "progress", title: "My title", text: "ignored", percent: 10, token: TOKEN });
    const called = mocks.handleSendNewProgress.mock.calls[0][0] as Record<string, unknown>;
    expect(called.title).toBe("My title");
  });
});

// =============================================================================
// Hybrid auto-split on caption overflow
// =============================================================================
describe("hybrid auto-split on caption overflow", () => {
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
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 43 });
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    mocks.showTyping.mockResolvedValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  it("sends two messages when text exceeds 1024-char limit with audio, response has split:true, both IDs, and _hint", async () => {
    const longText = "X".repeat(970); // > MAX_CAPTION (964)
    const result = await call({ text: longText, audio: "hello", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);

    // Both sends happened
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();

    // Response shape
    expect(data.split).toBe(true);
    expect(data.message_id).toBe(43);
    expect(data.text_message_id).toBe(99);

    // Voice note sent with no caption (overflow → no caption)
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeUndefined();

    // Text message sent with MarkdownV2
    const textCallArgs = mocks.sendMessage.mock.calls[0] as [unknown, unknown, { parse_mode?: string }];
    expect(textCallArgs[2].parse_mode).toBe("MarkdownV2");
  });

  it("sends single hybrid message (no split) when text is under the 1024-char limit", async () => {
    const shortText = "Y".repeat(500); // < MAX_CAPTION (964)
    const result = await call({ text: shortText, audio: "hello", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);

    // Only voice sent, no separate text message
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    // Response shape — no split
    expect(data.split).toBeUndefined();
    expect(data.text_message_id).toBeUndefined();
    expect(data.message_id).toBe(43);

    // Caption present on the voice note
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeDefined();
  });
});

// =============================================================================
// 10-621: findUnrenderableChars scans finalText (not raw text)
// =============================================================================
describe("unrenderable char warning — scans finalText including topic prefix", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveChat.mockReturnValue(42);
    mocks.validateText.mockReturnValue(null);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    // markdownToV2 passes through — we control the injected prefix directly
    mocks.markdownToV2.mockImplementation((t: string) => t);
    mocks.sendMessage.mockResolvedValue({ message_id: 42 });
    mocks.deliverServiceMessage.mockReturnValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  it("does NOT trigger warning when topic prefix contains an em-dash (no longer flagged)", async () => {
    mocks.applyTopicToText.mockImplementation((t: string) => `\u2014Topic\u2014\n${t}`);

    const result = await call({ text: "hello", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).message_id).toBe(42);
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("does NOT trigger warning when topic prefix is clean ASCII and text is clean ASCII", async () => {
    mocks.applyTopicToText.mockImplementation((t: string) => `[MyTopic]\n${t}`);

    const result = await call({ text: "hello", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 10-622: unrenderable char scan in audio+caption and captionOverflow paths
// =============================================================================
describe("unrenderable char warning — audio+caption and captionOverflow paths", () => {
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
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 43 });
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.deliverServiceMessage.mockReturnValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  // ---------------------------------------------------------------------------
  // Audio + caption (inline) — unrenderable char in caption text
  // ---------------------------------------------------------------------------
  it("audio+caption: no warning when caption contains an em-dash (no longer flagged)", async () => {
    const captionWithEmDash = "Status\u2014done"; // em dash U+2014 — no longer flagged
    const result = await call({ text: captionWithEmDash, audio: "spoken content", async: false, token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("audio+caption: no warning when caption is clean ASCII", async () => {
    const result = await call({ text: "clean caption text", audio: "spoken", async: false, token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // captionOverflow path — unrenderable char in overflow text message
  // ---------------------------------------------------------------------------
  it("captionOverflow: fires warning when overflow text message contains an unrenderable char", async () => {
    // Build a string > MAX_CAPTION (1024-60=964) that contains an arrow (→ U+2192)
    const longTextWithBadChar = "A".repeat(962) + "\u2192end"; // 966 chars > 964, contains →
    const result = await call({ text: longTextWithBadChar, audio: "hello", async: false, token: TOKEN });

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // captionOverflow triggered: voice sent + separate text message
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(data.split).toBe(true);
    // Warning fired for the overflow text
    expect(mocks.deliverServiceMessage).toHaveBeenCalledOnce();
    const warningMsg = (mocks.deliverServiceMessage.mock.calls[0] as unknown[])[1] as string;
    expect(warningMsg).toContain("U+2192");
    const eventType = (mocks.deliverServiceMessage.mock.calls[0] as unknown[])[2] as string;
    expect(eventType).toBe("unrenderable_chars_warning");
  });
});

// =============================================================================
// First-use hint key correctness + happy-path routing for new branches
// =============================================================================
describe("send — first-use hint injection and happy-path routing", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const HINT_SENTINEL = "__test_hint__";
  // Factory returns a fresh object each time to prevent mutations from leaking across tests.
  const makeOkResult = () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveChat.mockReturnValue(42);
    mocks.validateText.mockReturnValue(null);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.markdownToV2.mockImplementation((t: string) => t);
    mocks.applyTopicToText.mockImplementation((t: string) => t);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    // Return the sentinel hint for all calls
    mocks.getFirstUseHint.mockReturnValue(HINT_SENTINEL);
    // Default handler mocks return a fresh result each call to avoid cross-test mutation.
    mocks.handleSendChoice.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleSendNewChecklist.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleAsk.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleChoose.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleShowAnimation.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleSendNewProgress.mockImplementation(() => Promise.resolve(makeOkResult()));
    mocks.handleAppendText.mockImplementation(() => Promise.resolve(makeOkResult()));

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  // ---------------------------------------------------------------------------
  // Hint key correctness: verify exact key passed to getFirstUseHint per branch
  // ---------------------------------------------------------------------------

  it("choice branch passes 'send:choice' hint key and injects hint into result", async () => {
    const result = await call({
      type: "choice",
      text: "Pick one",
      options: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendChoice).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:choice");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  it("append branch passes 'send:append' hint key and injects hint into result", async () => {
    const result = await call({
      type: "append",
      message_id: 10,
      text: "more text",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleAppendText).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:append");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  it("animation branch passes 'send:animation' hint key and injects hint into result", async () => {
    const result = await call({
      type: "animation",
      preset: "working",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleShowAnimation).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:animation");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  it("checklist branch passes 'send:checklist' hint key and injects hint into result", async () => {
    const result = await call({
      type: "checklist",
      title: "My Steps",
      steps: [{ label: "Step 1", status: "pending" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendNewChecklist).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:checklist");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  it("progress branch passes 'send:progress' hint key and injects hint into result", async () => {
    const result = await call({
      type: "progress",
      percent: 50,
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleSendNewProgress).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:progress");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  it("question/choose branch passes 'send:question:choose' hint key and injects hint into result", async () => {
    const result = await call({
      type: "question",
      text: "Pick one",
      choose: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleChoose).toHaveBeenCalledOnce();
    expect(mocks.getFirstUseHint).toHaveBeenCalledWith(expect.any(Number), "send:question:choose");
    const data = parseResult(result);
    expect(data._first_use_hint).toBe(HINT_SENTINEL);
  });

  // ---------------------------------------------------------------------------
  // Happy-path routing: verify handlers are called for previously untested branches
  // ---------------------------------------------------------------------------

  it("question/ask happy path: routes to handleAsk", async () => {
    const result = await call({
      type: "question",
      ask: "What is your name?",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.handleAsk).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Verify null hint does NOT inject _first_use_hint field
  // ---------------------------------------------------------------------------

  it("when getFirstUseHint returns null, _first_use_hint is absent from result", async () => {
    mocks.getFirstUseHint.mockReturnValue(null);
    // Use a fresh result object to avoid cross-test mutation from appendHintToResult
    mocks.handleSendChoice.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
    const result = await call({
      type: "choice",
      text: "Pick one",
      options: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data._first_use_hint).toBeUndefined();
  });
});

// =============================================================================
// Audio markup leak detection
// =============================================================================
describe("audio markup leak detection", () => {
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
    mocks.sendVoiceDirect.mockResolvedValue(SENT_VOICE_MSG);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.deliverServiceMessage.mockReturnValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  it("audio markup leak: </audio> tag → strips audio and returns AUDIO_MARKUP_LEAK warning", async () => {
    const result = await call({
      audio: "Diagnosis. TMCP help send hybrid guidance is underspecified.</audio>\n<parameter name=\"text\">TMCP bug located.</parameter>",
      async: false,
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.warning).toBeDefined();
    expect((data.warning as { code: string }).code).toBe("AUDIO_MARKUP_LEAK");
    // TTS should receive only the pre-tag content (voice/speed are undefined from mocks)
    expect(mocks.synthesizeToOgg).toHaveBeenCalledWith(
      "Diagnosis. TMCP help send hybrid guidance is underspecified.",
      undefined,
      undefined,
    );
  });

  it("audio markup leak: recovers caption from trailing <parameter name=\"text\"> block", async () => {
    const result = await call({
      audio: "Voice content here.</audio>\n<parameter name=\"text\">Recovered caption text.</parameter>",
      async: false,
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.warning).toBeDefined();
    // Caption (effectiveText) should have been passed to markdownToV2
    expect(mocks.markdownToV2).toHaveBeenCalledWith(expect.stringContaining("Recovered caption text."));
  });

  it("clean audio payload: no warning in response", async () => {
    const result = await call({ audio: "Clean voice message.", async: false, token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.warning).toBeUndefined();
  });
});
