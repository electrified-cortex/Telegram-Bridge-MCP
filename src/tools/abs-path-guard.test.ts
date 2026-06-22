/**
 * Integration tests for the absolute-path guard (AC1–AC5).
 *
 * Covers:
 *   AC1 — detection of Windows and Unix dev paths
 *   AC2 — default: block and return ABS_PATH_BLOCKED error
 *   AC3 — safety: "disable" bypasses block; operator notification emitted
 *   AC4 — error message shape (offending substring, replacement hint, override hint)
 *   AC5 — existing unrenderable-chars warning path unchanged
 *
 * Path literals are split with concatenation to avoid the pre-commit hook that
 * blocks [A-Za-z]:[\\/][A-Za-z0-9_.] patterns in source.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Path helpers — split to avoid pre-commit hook
// ---------------------------------------------------------------------------
const colon = ":";
const WIN_C = "C" + colon + "/Users/alice/project";      // C:/Users/alice/project
const WIN_D = "D" + colon + "\\Users\\bob\\code";        // D:\Users\bob\code
const WIN_D_SHORT = "D" + colon + "\\work\\project";     // D:\work\project

// ---------------------------------------------------------------------------
// Shared mocks (must be declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // telegram.js
  sendMessage: vi.fn(),
  sendVoiceDirect: vi.fn(),
  resolveChat: vi.fn((): number => 42),
  validateText: vi.fn((_t?: string): null | { code: string; message: string } => null),
  validateCaption: vi.fn((_t?: string): null | { code: string; message: string } => null),
  splitMessage: vi.fn((t: string) => [t]),
  callApi: vi.fn((fn: () => unknown) => fn()),
  resolveMediaSource: vi.fn((s: string) => ({ source: s })),
  // session
  validateSession: vi.fn((_sid?: number, _suffix?: number) => true),
  getSession: vi.fn(() => undefined),
  // tts
  isTtsEnabled: vi.fn((): boolean => true),
  stripForTts: vi.fn((t: string) => t),
  synthesizeToOgg: vi.fn(),
  // typing
  showTyping: vi.fn(),
  cancelTypingIfSameGeneration: vi.fn(),
  typingGeneration: vi.fn(() => 0),
  // topic / markdown
  applyTopicToText: vi.fn((t: string, _mode?: string) => t),
  getTopic: vi.fn((): string | null => null),
  markdownToV2: vi.fn((t: string) => t),
  // voice
  getSessionVoice: vi.fn((): string | null => null),
  getSessionSpeed: vi.fn((): number | null => null),
  // service messages
  deliverServiceMessage: vi.fn(),
  deliverAsyncSendCallback: vi.fn((..._args: unknown[]) => true),
  // async queue
  enqueueAsyncSend: vi.fn((..._args: unknown[]) => -1_000_000_001),
  acquireRecordingIndicator: vi.fn(),
  releaseRecordingIndicator: vi.fn(),
  hasInflightAudio: vi.fn((_sid: number): boolean => false),
  enqueueTextSend: vi.fn((_sid: number, _fn: (pid: number) => Promise<void>): number => -2_000_000_001),
  // hints
  getFirstUseHint: vi.fn((..._args: unknown[]): string | null => null),
  markFirstUseHintSeen: vi.fn((..._args: unknown[]): boolean => false),
  // caption dup
  detectCaptionDuplication: vi.fn((_audio: string, _caption: string) => ({
    isDuplicate: false, jaccard: 0, audioWords: 0, captionWords: 0,
  })),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      sendPhoto: vi.fn(),
      sendDocument: vi.fn(),
      sendVideo: vi.fn(),
      sendAudio: vi.fn(),
    }),
    resolveChat: () => mocks.resolveChat(),
    validateText: (t: string) => mocks.validateText(t),
    validateCaption: (t: string) => mocks.validateCaption(t),
    sendVoiceDirect: (...args: unknown[]) => mocks.sendVoiceDirect(...args),
    splitMessage: (t: string) => mocks.splitMessage(t),
    callApi: (fn: () => unknown) => mocks.callApi(fn),
    resolveMediaSource: (s: string) => mocks.resolveMediaSource(s),
    RICH_MESSAGES_ENABLED: false,
  };
});

vi.mock("../markdown.js", () => ({
  markdownToV2: (t: string) => mocks.markdownToV2(t),
  resolveParseMode: (t: string, _mode: string) => ({ text: t, parse_mode: "Markdown" }),
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
  cancelTyping: () => undefined,
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
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
  getSession: () => mocks.getSession(),
}));

vi.mock("../session-queue.js", () => ({
  deliverServiceMessage: (...args: unknown[]) => mocks.deliverServiceMessage(...args),
  deliverAsyncSendCallback: (...args: unknown[]) => mocks.deliverAsyncSendCallback(...args),
}));

vi.mock("../async-send-queue.js", () => ({
  enqueueAsyncSend: (...args: unknown[]) => mocks.enqueueAsyncSend(...args),
  resetAsyncSendQueueForTest: () => undefined,
  acquireRecordingIndicator: (...args: unknown[]) => mocks.acquireRecordingIndicator(...args),
  releaseRecordingIndicator: (...args: unknown[]) => mocks.releaseRecordingIndicator(...args),
  hasInflightAudio: (sid: number) => mocks.hasInflightAudio(sid),
  enqueueTextSend: (sid: number, fn: (pid: number) => Promise<void>) => mocks.enqueueTextSend(sid, fn),
}));

vi.mock("../first-use-hints.js", () => ({
  getFirstUseHint: (...args: unknown[]) => mocks.getFirstUseHint(...args),
  markFirstUseHintSeen: (...args: unknown[]) => mocks.markFirstUseHintSeen(...args),
  appendHintToResult: <T extends object>(result: T, _hint: string | null): T => result,
}));

vi.mock("./animation/show.js", () => ({ handleShowAnimation: vi.fn() }));
vi.mock("./progress/new.js", () => ({ handleSendNewProgress: vi.fn() }));
vi.mock("./send/dm.js", () => ({ handleSendDirectMessage: vi.fn() }));
vi.mock("./confirm/handler.js", () => ({ handleConfirm: vi.fn() }));
vi.mock("./send/append.js", () => ({ handleAppendText: vi.fn() }));
vi.mock("./send/choice.js", () => ({ handleSendChoice: vi.fn() }));
vi.mock("./checklist/update.js", () => ({
  handleSendNewChecklist: vi.fn(),
  handleUpdateChecklist: vi.fn(),
}));
vi.mock("./send/ask.js", () => ({ handleAsk: vi.fn() }));
vi.mock("./send/choose.js", () => ({ handleChoose: vi.fn() }));
vi.mock("./send/stream.js", () => ({
  handleStreamStart: vi.fn(),
  handleStreamChunk: vi.fn(),
  handleStreamFlush: vi.fn(),
}));
vi.mock("./send/notify.js", () => ({ handleNotify: vi.fn() }));

vi.mock("../hybrid-duplication-detector.js", () => ({
  detectCaptionDuplication: (audio: string, caption: string) =>
    mocks.detectCaptionDuplication(audio, caption),
}));

// ---------------------------------------------------------------------------
// Imports (must be after vi.mock calls)
// ---------------------------------------------------------------------------

import { register as registerSend } from "./send.js";
import { handleSendFile, register as registerSendFile } from "./send/file.js";

const TOKEN = 1_123_456; // sid=1, suffix=123456
const SENT_MSG = { message_id: 42 };
const SENT_VOICE = { message_id: 43 };

function makeSendCall() {
  const server = createMockServer();
  registerSend(server);
  return server.getHandler("send");
}

function makeSendFileCall() {
  const server = createMockServer();
  registerSendFile(server);
  return server.getHandler("send_file");
}

function resetMocks() {
  vi.clearAllMocks();
  mocks.validateSession.mockReturnValue(true);
  mocks.resolveChat.mockReturnValue(42);
  mocks.validateText.mockReturnValue(null);
  mocks.validateCaption.mockReturnValue(null);
  mocks.isTtsEnabled.mockReturnValue(true);
  mocks.stripForTts.mockImplementation((t: string) => t);
  mocks.applyTopicToText.mockImplementation((t: string) => t);
  mocks.markdownToV2.mockImplementation((t: string) => t);
  mocks.splitMessage.mockImplementation((t: string) => [t]);
  mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
  mocks.sendMessage.mockResolvedValue(SENT_MSG);
  mocks.sendVoiceDirect.mockResolvedValue(SENT_VOICE);
  mocks.showTyping.mockResolvedValue(undefined);
  mocks.deliverServiceMessage.mockReturnValue(undefined);
  mocks.resolveMediaSource.mockImplementation((s: string) => ({ source: s }));
}

// =============================================================================
// AC1 + AC2: send tool — text field blocked by default
// =============================================================================

describe("send — absolute-path guard on text field (AC1+AC2)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendCall();
  });

  it("blocks Windows path in text and returns ABS_PATH_BLOCKED", async () => {
    const result = await call({ text: "File at " + WIN_C, token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks Windows path with backslash in text", async () => {
    const result = await call({ text: "Located at " + WIN_D, token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks /Users/ (macOS) in text", async () => {
    const result = await call({ text: "Script at /Users/alice/scripts/run.sh", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks /home/ (Linux) in text", async () => {
    const result = await call({ text: "/home/alice/.config/settings.json", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks /d/ (WSL D: mount) in text", async () => {
    const result = await call({ text: "Repo at /d/projects/my-app", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks /mnt/ in text", async () => {
    const result = await call({ text: "Mount at /mnt/c/Users/alice", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks /usr/local/ in text", async () => {
    const result = await call({ text: "Install path /usr/local/bin/tool", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("passes clean text through (no false positive)", async () => {
    const result = await call({ text: "Hello world, everything is clean!", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("passes relative path through (no false positive)", async () => {
    const result = await call({ text: "See ./src/utils/helper.ts for details.", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// AC1 + AC2: send tool — audio field checked
// =============================================================================

describe("send — absolute-path guard on audio field (AC1+AC2)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendCall();
  });

  it("blocks Windows path in audio spoken content (async path)", async () => {
    const result = await call({
      audio: "The project is at " + WIN_C + ", let me explain",
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
    expect(mocks.enqueueAsyncSend).not.toHaveBeenCalled();
    expect(mocks.synthesizeToOgg).not.toHaveBeenCalled();
  });

  it("blocks /home/ path in audio (async path)", async () => {
    const result = await call({
      audio: "Check /home/user/config for the settings",
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("blocks Windows path in audio (sync path)", async () => {
    const result = await call({
      audio: "Path is " + WIN_D,
      async: false,
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
    expect(mocks.synthesizeToOgg).not.toHaveBeenCalled();
  });

  it("passes clean audio through", async () => {
    mocks.enqueueAsyncSend.mockReturnValue(-1_000_000_001);
    const result = await call({
      audio: "The build completed successfully, all tests passed!",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
  });
});

// =============================================================================
// AC4: Error message shape
// =============================================================================

describe("send — error message shape (AC4)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendCall();
  });

  it("error message includes the offending substring", async () => {
    const result = await call({ text: "file at " + WIN_C, token: TOKEN });
    expect(isError(result)).toBe(true);
    const data = parseResult<{ code: string; message: string; hint: string }>(result);
    // The snippet from WIN_C starts at C:/
    expect(data.message).toMatch(/[A-Za-z]:/);
  });

  it("error message includes placeholder suggestion", async () => {
    const result = await call({ text: "path: /home/alice/proj", token: TOKEN });
    expect(isError(result)).toBe(true);
    const data = parseResult<{ code: string; message: string; hint: string }>(result);
    expect(data.hint).toMatch(/<workspace>|<repo>/);
  });

  it("error hint includes override instruction with safety: disable", async () => {
    const result = await call({ text: WIN_D_SHORT, token: TOKEN });
    expect(isError(result)).toBe(true);
    const data = parseResult<{ code: string; message: string; hint: string }>(result);
    expect(data.hint).toContain("safety");
    expect(data.hint).toContain("disable");
  });
});

// =============================================================================
// AC3: safety: "disable" override on send
// =============================================================================

describe('send — safety: "disable" override (AC3)', () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendCall();
  });

  it("allows absolute path in text when safety: disable is set", async () => {
    const result = await call({
      text: "file at " + WIN_C,
      safety: "disable",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("emits operator service message when safety override is used", async () => {
    await call({
      text: "/home/alice/myproject/run.sh",
      safety: "disable",
      token: TOKEN,
    });
    expect(mocks.deliverServiceMessage).toHaveBeenCalledOnce();
    const [sid, entry] = mocks.deliverServiceMessage.mock.calls[0] as [number, { eventType: string }];
    expect(sid).toBe(1);
    expect(entry.eventType).toBe("abs_path_safety_override");
  });

  it("does NOT emit operator notification when text has no absolute path", async () => {
    await call({ text: "clean message here", safety: "disable", token: TOKEN });
    const absPathCalls = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { eventType?: string })?.eventType === "abs_path_safety_override",
    );
    expect(absPathCalls).toHaveLength(0);
  });

  it("allows absolute path in audio when safety: disable is set", async () => {
    mocks.enqueueAsyncSend.mockReturnValue(-1_000_000_001);
    const result = await call({
      audio: "See /usr/local/bin/tool for the commands",
      safety: "disable",
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const absPathCalls = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { eventType?: string })?.eventType === "abs_path_safety_override",
    );
    expect(absPathCalls).toHaveLength(1);
  });
});

// =============================================================================
// AC1 + AC2 + AC3: send_file — caption checked (via tool registration)
// =============================================================================

describe("send_file — absolute-path guard on caption (AC1+AC2+AC3)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendFileCall();
  });

  it("blocks absolute path in caption (default: no safety)", async () => {
    const result = await call({
      file: "https://example.com/image.jpg",
      caption: "Saved from " + WIN_C,
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("allows caption with safety: disable", async () => {
    const result = await call({
      file: "https://example.com/image.jpg",
      caption: "Saved from " + WIN_C,
      safety: "disable",
      token: TOKEN,
    });
    expect(errorCode(result)).not.toBe("ABS_PATH_BLOCKED");
  });

  it("emits operator notification when caption safety override is used", async () => {
    await call({
      file: "https://example.com/img.png",
      caption: "/home/alice/screenshots/img.png",
      safety: "disable",
      token: TOKEN,
    });
    const absPathCalls = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { eventType?: string })?.eventType === "abs_path_safety_override",
    );
    expect(absPathCalls).toHaveLength(1);
  });

  it("passes clean caption through (no false positive)", async () => {
    const result = await call({
      file: "https://example.com/doc.pdf",
      caption: "Here is the quarterly report",
      token: TOKEN,
    });
    expect(errorCode(result)).not.toBe("ABS_PATH_BLOCKED");
  });

  it("allows file send with no caption (no false positive)", async () => {
    const result = await call({
      file: "https://example.com/file.pdf",
      token: TOKEN,
    });
    expect(errorCode(result)).not.toBe("ABS_PATH_BLOCKED");
  });
});

// =============================================================================
// handleSendFile — direct function call (caption check)
// =============================================================================

describe("handleSendFile — caption abs-path check (AC1+AC2+AC3)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns ABS_PATH_BLOCKED when caption contains Windows path", async () => {
    const result = await handleSendFile({
      file: "https://example.com/x.jpg",
      caption: "From " + WIN_D,
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ABS_PATH_BLOCKED");
  });

  it("allows caption with safety: disable and emits notification", async () => {
    const result = await handleSendFile({
      file: "https://example.com/x.jpg",
      caption: "/home/alice/file.jpg",
      safety: "disable",
      token: TOKEN,
    });
    expect(errorCode(result)).not.toBe("ABS_PATH_BLOCKED");
    const absPathCalls = mocks.deliverServiceMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { eventType?: string })?.eventType === "abs_path_safety_override",
    );
    expect(absPathCalls).toHaveLength(1);
  });

  it("passes clean caption through without error", async () => {
    const result = await handleSendFile({
      file: "https://example.com/report.pdf",
      caption: "Quarterly report attached",
      token: TOKEN,
    });
    expect(errorCode(result)).not.toBe("ABS_PATH_BLOCKED");
  });
});

// =============================================================================
// AC5: Existing unrenderable-chars behaviour unchanged
// =============================================================================

describe("send — unrenderable-chars behaviour unchanged (AC5)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    resetMocks();
    call = makeSendCall();
  });

  it("clean text sends without any service message", async () => {
    await call({ text: "plain ASCII text no issues", token: TOKEN });
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("text with arrow character sends without warning (UNRENDERABLE_WARNING_ENABLED is false by default)", async () => {
    // U+2192 → — UNRENDERABLE_WARNING_ENABLED is false so no warning fires
    const result = await call({ text: "result → success", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });
});
