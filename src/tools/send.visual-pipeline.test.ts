/**
 * Integration tests: visual attachment pipeline wired into the `send` tool.
 *
 * Verifies that SVG and Mermaid blocks detected by `detectAndExtract` are:
 * 1. Written to disk via `writeTempVisualFile`
 * 2. Sent as Telegram documents via `sendDocument`
 * 3. Replaced with placeholders in the prose that is then sent via `sendMessage`
 * 4. Ordered correctly (documents before prose)
 *
 * This file mirrors the mock setup of `send.test.ts` exactly, adding:
 * - `sendDocument` mock in `getApi()` return
 * - `resolveMediaSource` mock exposed from telegram.js
 * - vi.mock for `../visual-attachment-pipeline.js`
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  // ── visual pipeline ──────────────────────────────────────────────────────
  detectAndExtract: vi.fn((t: string) => ({ modifiedText: t, blocks: [] as unknown[] })),
  writeTempVisualFile: vi.fn((_block: unknown) => Promise.resolve("/tmp/telegram-bridge-mcp/diagram-0-0.svg")),
  resolveMediaSource: vi.fn((_path: string) => ({
    source: "/tmp/telegram-bridge-mcp/diagram-0-0.svg",
  })),
  sendDocument: vi.fn(),
  // ── telegram / send ──────────────────────────────────────────────────────
  sendMessage: vi.fn(),
  sendVoiceDirect: vi.fn(),
  resolveChat: vi.fn((): number => 42),
  validateText: vi.fn((_t?: string): null | { code: string; message: string } => null),
  isTtsEnabled: vi.fn((): boolean => true),
  stripForTts: vi.fn((t: string) => t),
  synthesizeToOgg: vi.fn(),
  applyTopicToText: vi.fn((t: string, _mode?: string) => t),
  getTopic: vi.fn((): string | null => null),
  showTyping: vi.fn(),
  cancelTyping: vi.fn(),
  typingGeneration: vi.fn(() => 0),
  cancelTypingIfSameGeneration: vi.fn(),
  getSessionVoice: vi.fn((): string | null => null),
  getSessionSpeed: vi.fn((): number | null => null),
  splitMessage: vi.fn((t: string) => [t]),
  markdownToV2: vi.fn((t: string) => t),
  validateSession: vi.fn((_sid?: number, _suffix?: number) => true),
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
  deliverAsyncSendCallback: vi.fn((..._args: unknown[]) => true),
  getFirstUseHint: vi.fn((..._args: unknown[]): string | null => null),
  markFirstUseHintSeen: vi.fn((..._args: unknown[]): boolean => false),
  enqueueAsyncSend: vi.fn((..._args: unknown[]) => -1_000_000_001),
  resetAsyncSendQueueForTest: vi.fn(),
  acquireRecordingIndicator: vi.fn(),
  releaseRecordingIndicator: vi.fn(),
  hasInflightAudio: vi.fn((_sid: number): boolean => false),
  enqueueTextSend: vi.fn((_sid: number, _fn: (pid: number) => Promise<void>): number => -2_000_000_001),
  detectCaptionDuplication: vi.fn((_audio: string, _caption: string) => ({
    isDuplicate: false,
    jaccard: 0,
    audioWords: 0,
    captionWords: 0,
  })),
}));

// ── Visual pipeline mock ─────────────────────────────────────────────────────
vi.mock("../visual-attachment-pipeline.js", () => ({
  // _opts is accepted but ignored — the mock is not mode-aware
  detectAndExtract: (t: string, _opts?: unknown) => mocks.detectAndExtract(t),
  writeTempVisualFile: (block: unknown) => mocks.writeTempVisualFile(block),
}));

// ── Telegram mock (extends the base with sendDocument + resolveMediaSource) ──
vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      sendDocument: mocks.sendDocument,
    }),
    resolveChat: () => mocks.resolveChat(),
    validateText: (t: string) => mocks.validateText(t),
    sendVoiceDirect: (...args: unknown[]) => mocks.sendVoiceDirect(...args),
    splitMessage: (t: string) => mocks.splitMessage(t),
    callApi: (fn: () => unknown) => fn(),
    resolveMediaSource: (path: string) => mocks.resolveMediaSource(path),
    isRichMessagesEnabled: () => false,
    routeOutboundMessage: vi.fn(),
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
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
  getSession: () => undefined,
}));

vi.mock("./animation/show.js", () => ({
  handleShowAnimation: (args: unknown) => mocks.handleShowAnimation(args),
}));

vi.mock("./progress/new.js", () => ({
  handleSendNewProgress: (args: unknown) => mocks.handleSendNewProgress(args),
}));

vi.mock("./send/dm.js", () => ({
  handleSendDirectMessage: (args: unknown) => mocks.handleSendDirectMessage(args),
}));

vi.mock("./confirm/handler.js", () => ({
  handleConfirm: (args: unknown) => mocks.handleConfirm(args),
}));

vi.mock("./send/append.js", () => ({
  handleAppendText: (args: unknown) => mocks.handleAppendText(args),
}));

vi.mock("../session-queue.js", () => ({
  deliverServiceMessage: (...args: unknown[]) => mocks.deliverServiceMessage(...args),
  deliverAsyncSendCallback: (...args: unknown[]) => mocks.deliverAsyncSendCallback(...args),
}));

vi.mock("../async-send-queue.js", () => ({
  enqueueAsyncSend: (...args: unknown[]) => mocks.enqueueAsyncSend(...args),
  resetAsyncSendQueueForTest: () => mocks.resetAsyncSendQueueForTest(),
  acquireRecordingIndicator: (...args: unknown[]) => mocks.acquireRecordingIndicator(...args),
  releaseRecordingIndicator: (...args: unknown[]) => mocks.releaseRecordingIndicator(...args),
  hasInflightAudio: (sid: number) => mocks.hasInflightAudio(sid),
  enqueueTextSend: (sid: number, fn: (pid: number) => Promise<void>) => mocks.enqueueTextSend(sid, fn),
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
    } catch { /* no-op */ }
    return result;
  },
}));

vi.mock("./send/choice.js", () => ({
  handleSendChoice: (args: unknown) => mocks.handleSendChoice(args),
}));

vi.mock("./checklist/update.js", () => ({
  handleSendNewChecklist: (args: unknown) => mocks.handleSendNewChecklist(args),
}));

vi.mock("./send/ask.js", () => ({
  handleAsk: (args: unknown, signal: unknown) => mocks.handleAsk(args, signal),
}));

vi.mock("./send/choose.js", () => ({
  handleChoose: (args: unknown, signal: unknown) => mocks.handleChoose(args, signal),
}));

vi.mock("../hybrid-duplication-detector.js", () => ({
  detectCaptionDuplication: (audio: string, caption: string) =>
    mocks.detectCaptionDuplication(audio, caption),
}));

import { register } from "./send.js";

const TOKEN = 1_123_456; // sid=1, suffix=123456
const SENT_MSG = { message_id: 42 };
const SENT_DOC = { message_id: 10, document: { file_id: "docId", file_name: "diagram.svg" } };

// ---------------------------------------------------------------------------
// Helpers — build a mock visual block
// ---------------------------------------------------------------------------

function makeSvgBlock(index = 0) {
  return {
    type: "svg" as const,
    content: '<svg width="100%"><rect/></svg>',
    // Unique placeholder matching the real pipeline's per-block format.
    placeholder: `🖼 [SVG attached·${index}]`,
    filename: `diagram-1-${index}.svg`,
  };
}

function makeMmdBlock(index = 0) {
  return {
    type: "mermaid" as const,
    content: "graph TD\nA-->B",
    // Unique placeholder matching the real pipeline's per-block format.
    placeholder: `📊 [diagram attached·${index}]`,
    filename: `diagram-1-${index}.mmd`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("send — visual attachment pipeline integration", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Auth + infrastructure defaults
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveChat.mockReturnValue(42);
    mocks.validateText.mockReturnValue(null);
    mocks.applyTopicToText.mockImplementation((t: string) => t);
    mocks.markdownToV2.mockImplementation((t: string) => t);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.sendDocument.mockResolvedValue(SENT_DOC);
    // Pipeline defaults — no blocks detected, passthrough
    mocks.detectAndExtract.mockImplementation((t: string) => ({ modifiedText: t, blocks: [] }));
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/diagram-0-0.svg");
    mocks.resolveMediaSource.mockReturnValue({ source: "/tmp/telegram-bridge-mcp/diagram-0-0.svg" });

    const server = createMockServer();
    register(server);
    call = server.getHandler("send");
  });

  // ── Passthrough when no blocks ─────────────────────────────────────────────

  it("plain text with no visual markers: detectAndExtract skipped, sendMessage called", async () => {
    // WARN-4: cheap pre-check (`includes('<svg')` / `includes('```mermaid')`)
    // skips the pipeline entirely for ordinary text — detectAndExtract is NOT called.
    const result = await call({ text: "Hello world!", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.detectAndExtract).not.toHaveBeenCalled();
    expect(mocks.writeTempVisualFile).not.toHaveBeenCalled();
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
  });

  it("text containing '<svg' but no blocks detected: detectAndExtract called, no document sent", async () => {
    // Pre-check passes (text contains '<svg'), pipeline runs but finds 0 blocks.
    const result = await call({ text: "Use <svg> for diagrams.", token: TOKEN });
    expect(isError(result)).toBe(false);
    expect(mocks.detectAndExtract).toHaveBeenCalledWith("Use <svg> for diagrams.");
    expect(mocks.writeTempVisualFile).not.toHaveBeenCalled();
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  // ── SVG block detected ────────────────────────────────────────────────────

  it("SVG block: sends document then prose, result has message_id from prose", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });

    const result = await call({ text: "<svg><rect/></svg>", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.writeTempVisualFile).toHaveBeenCalledOnce();
    expect(mocks.writeTempVisualFile).toHaveBeenCalledWith(block);
    expect(mocks.resolveMediaSource).toHaveBeenCalledOnce();
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
    // Prose is then sent with the placeholder text
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
  });

  it("SVG block: sendDocument receives the resolved media source as the file", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/diagram-1-0.svg");
    mocks.resolveMediaSource.mockReturnValue({ source: "/tmp/telegram-bridge-mcp/diagram-1-0.svg" });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    const [chatId, source] = mocks.sendDocument.mock.calls[0] as [number, string, unknown];
    expect(chatId).toBe(42);
    expect(source).toBe("/tmp/telegram-bridge-mcp/diagram-1-0.svg");
  });

  it("SVG block: sendDocument caption matches the block placeholder", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    const [, , opts] = mocks.sendDocument.mock.calls[0] as [number, string, { caption?: string }];
    expect(opts?.caption).toBe(block.placeholder);
  });

  it("SVG block: applyTopicToText receives modified text (placeholder), not the raw SVG", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    // Check the first argument only — the key assertion is that the placeholder
    // text (not the raw SVG source) is forwarded to applyTopicToText.
    // The parse_mode and topic arguments are not the focus of this test.
    expect(mocks.applyTopicToText.mock.calls[0]?.[0]).toBe(block.placeholder);
  });

  // ── Mermaid block detected ────────────────────────────────────────────────

  it("Mermaid block: sends document then prose", async () => {
    const block = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });

    const result = await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("Mermaid block: sendDocument caption is the mermaid placeholder", async () => {
    const block = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });

    await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    const [, , opts] = mocks.sendDocument.mock.calls[0] as [number, string, { caption?: string }];
    expect(opts?.caption).toBe(block.placeholder);
  });

  // ── Multiple blocks ────────────────────────────────────────────────────────

  it("multiple blocks: sendDocument called once per block", async () => {
    const block1 = makeSvgBlock(0);
    const block2 = makeSvgBlock(1);
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: `${block1.placeholder} ${block2.placeholder}`,
      blocks: [block1, block2],
    });
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.svg")
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-1.svg");

    await call({ text: "<svg/><svg/>", token: TOKEN });

    expect(mocks.writeTempVisualFile).toHaveBeenCalledTimes(2);
    expect(mocks.sendDocument).toHaveBeenCalledTimes(2);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("multiple blocks: sendDocument calls precede sendMessage call (ordering)", async () => {
    const callOrder: string[] = [];
    mocks.sendDocument.mockImplementation(() => {
      callOrder.push("doc");
      return Promise.resolve(SENT_DOC);
    });
    mocks.sendMessage.mockImplementation(() => {
      callOrder.push("msg");
      return Promise.resolve(SENT_MSG);
    });

    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    expect(callOrder).toEqual(["doc", "msg"]);
  });

  // ── disable_notification propagation ─────────────────────────────────────

  it("disable_notification is propagated to sendDocument", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });

    await call({ text: "<svg><rect/></svg>", disable_notification: true, token: TOKEN });

    const [, , opts] = mocks.sendDocument.mock.calls[0] as [number, string, { disable_notification?: boolean }];
    expect(opts?.disable_notification).toBe(true);
  });

  // ── Graceful failure paths ────────────────────────────────────────────────

  it("graceful — writeTempVisualFile rejects: prose still sent, result is not error", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    mocks.writeTempVisualFile.mockRejectedValue(new Error("disk full"));

    const result = await call({ text: "<svg><rect/></svg>", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("graceful — resolveMediaSource returns error object: document skipped, prose still sent", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.resolveMediaSource.mockReturnValue({ code: "UNKNOWN", message: "path not allowed" } as any);

    const result = await call({ text: "<svg><rect/></svg>", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("graceful — sendDocument rejects: prose still sent, result is not error", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    mocks.sendDocument.mockRejectedValue(new Error("Telegram API error"));

    const result = await call({ text: "<svg><rect/></svg>", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("FAIL-1: writeTempVisualFile rejects — orphan placeholder NOT forwarded to applyTopicToText", async () => {
    // Regression: when attachment send fails, the modified text (which has the
    // unique placeholder substituted in) must NOT reach applyTopicToText, because
    // the user would see the placeholder string with no actual document.
    // Fix: per-block success tracking; on failure restore placeholder → original content.
    // Unique placeholders ensure the string.replace targets exactly the right slot
    // even when multiple same-type blocks exist and some succeed while others fail.
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });
    mocks.writeTempVisualFile.mockRejectedValue(new Error("disk full"));

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    const proseArg = mocks.applyTopicToText.mock.calls[0]?.[0];
    // Orphan placeholder must not leak through
    expect(proseArg).not.toContain(block.placeholder);
    // Original block content is substituted instead
    expect(proseArg).toContain(block.content);
  });

  it("FAIL-1: resolveMediaSource error — orphan placeholder NOT forwarded to applyTopicToText", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.resolveMediaSource.mockReturnValue({ code: "UNKNOWN", message: "path not allowed" } as any);

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    const proseArg = mocks.applyTopicToText.mock.calls[0]?.[0];
    expect(proseArg).not.toContain(block.placeholder);
    expect(proseArg).toContain(block.content);
  });

  // ── Audio path does not call pipeline ────────────────────────────────────

  it("voice-only (audio path): detectAndExtract is NOT called", async () => {
    mocks.isTtsEnabled.mockReturnValue(true);
    mocks.stripForTts.mockReturnValue("hello");
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 43 });

    await call({ audio: "hello", async: false, token: TOKEN });

    expect(mocks.detectAndExtract).not.toHaveBeenCalled();
    expect(mocks.sendDocument).not.toHaveBeenCalled();
  });

  // ── showTyping called per block ────────────────────────────────────────────

  it("showTyping(60, upload_document) is called once per detected block", async () => {
    const block1 = makeSvgBlock(0);
    const block2 = makeMmdBlock(1);
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: `${block1.placeholder}\n${block2.placeholder}`,
      blocks: [block1, block2],
    });
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.svg")
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-1.mmd");

    await call({ text: "<svg/>\n```mermaid\ngraph TD\n```", token: TOKEN });

    const uploadDocCalls = mocks.showTyping.mock.calls.filter(
      (c: unknown[]) => c[0] === 60 && c[1] === "upload_document",
    );
    expect(uploadDocCalls).toHaveLength(2);
  });
});
