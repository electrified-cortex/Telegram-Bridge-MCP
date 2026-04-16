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
  handleShowAnimation: vi.fn(),
  handleSendNewProgress: vi.fn(),
  handleSendDirectMessage: vi.fn(),
  handleConfirm: vi.fn(),
  handleAppendText: vi.fn(),
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

  it("returns AUTH_FAILED when token has wrong pin", async () => {
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
    const result = await call({ text: longText, audio: "nova", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Voice note was sent (no caption)
    expect(mocks.synthesizeToOgg).toHaveBeenCalledOnce();
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    // Text message was sent separately
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    // Result has split + both IDs + _hint
    expect(data.audio).toBe(true);
    expect(data.split).toBe(true);
    expect(data.message_id).toBe(43);
    expect(data.text_message_id).toBe(99);
    expect(typeof data._hint).toBe("string");
    // Voice note sent with no caption
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Case 10: combined mode — no split when text is under limit
  // ---------------------------------------------------------------------------
  it("combined mode: no split when text is under 964 chars (single hybrid message)", async () => {
    const shortText = "A".repeat(963); // under MAX_CAPTION (964)
    const result = await call({ text: shortText, audio: "nova", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Voice note sent with caption
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(data.audio).toBe(true);
    expect(data.split).toBeUndefined();
    expect(data._hint).toBeUndefined();
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
    const result = await call({ audio: "hello world", token: TOKEN });
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

    const result = await call({ audio: "hello world chunk test", token: TOKEN });

    expect(isError(result)).toBe(true);
    // First chunk was already sent; error propagates from the second
    expect(mocks.synthesizeToOgg).toHaveBeenCalledTimes(2);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledTimes(1);
    // cancelTyping cleanup must still run (finally block)
    expect(mocks.cancelTyping).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Gap 2: VOICE_RESTRICTED — sendVoiceDirect throws privacy restriction error
  // ---------------------------------------------------------------------------
  it("VOICE_RESTRICTED: returns correct error when Telegram blocks voice due to privacy settings", async () => {
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
    mocks.sendVoiceDirect.mockRejectedValue(
      new Error("user restricted receiving of voice note messages"),
    );

    const result = await call({ audio: "say something", token: TOKEN });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("VOICE_RESTRICTED");
    // cancelTyping cleanup must still run (finally block)
    expect(mocks.cancelTyping).toHaveBeenCalled();
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

  it("message alias: send(message: 'hello') succeeds and returns hint field", async () => {
    const result = await call({ message: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBe("'message' is accepted as an alias. Canonical parameter: 'text'.");
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

  it("message alias: send(message: 'hello', audio: 'spoken') works — voice with caption alias", async () => {
    const result = await call({ message: "caption via alias", audio: "spoken content", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.audio).toBe(true);
    expect(data.hint).toBe("'message' is accepted as an alias. Canonical parameter: 'text'.");
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
    mocks.handleAppendText.mockResolvedValue({ content: [{ type: "text", text: '{"message_id":10,"length":14}' }] });
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
    const result = await call({ text: longText, audio: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);

    // Both sends happened
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();

    // Response shape
    expect(data.split).toBe(true);
    expect(data.audio).toBe(true);
    expect(data.message_id).toBe(43);
    expect(data.text_message_id).toBe(99);
    expect(typeof data._hint).toBe("string");
    expect(data._hint).toContain("43");
    expect(data._hint).toContain("99");

    // Voice note sent with no caption (overflow → no caption)
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeUndefined();

    // Text message sent with MarkdownV2
    const textCallArgs = mocks.sendMessage.mock.calls[0] as [unknown, unknown, { parse_mode?: string }];
    expect(textCallArgs[2].parse_mode).toBe("MarkdownV2");
  });

  it("sends single hybrid message (no split) when text is under the 1024-char limit", async () => {
    const shortText = "Y".repeat(500); // < MAX_CAPTION (964)
    const result = await call({ text: shortText, audio: "hello", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);

    // Only voice sent, no separate text message
    expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    // Response shape — no split
    expect(data.audio).toBe(true);
    expect(data.split).toBeUndefined();
    expect(data._hint).toBeUndefined();
    expect(data.text_message_id).toBeUndefined();
    expect(data.message_id).toBe(43);

    // Caption present on the voice note
    const voiceCallArgs = mocks.sendVoiceDirect.mock.calls[0] as [unknown, unknown, { caption?: string }];
    expect(voiceCallArgs[2].caption).toBeDefined();
  });
});
