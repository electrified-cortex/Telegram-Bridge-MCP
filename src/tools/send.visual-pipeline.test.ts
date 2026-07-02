/**
 * Integration tests: visual attachment pipeline wired into the `send` tool.
 *
 * Verifies that SVG and Mermaid blocks detected by `detectAndExtract` are:
 * 1. Written to disk via `writeTempVisualFile`
 * 2. Sent as Telegram documents via `sendDocument`
 * 3. Replaced with placeholders in the prose
 * 4. Ordered correctly:
 *    - Same-message delivery (single block, short text): `sendDocument` with prose
 *      as caption, no separate `sendMessage`.
 *    - Follow-up delivery (multiple blocks or long text): `sendMessage` prose FIRST,
 *      then `sendDocument` per block — attachment NEVER precedes prose.
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
  detectAndExtract: vi.fn((t: string, _opts?: unknown) => ({ modifiedText: t, blocks: [] as unknown[] })),
  writeTempVisualFile: vi.fn((_block: unknown) => Promise.resolve("/tmp/telegram-bridge-mcp/diagram-0-0.svg")),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMermaidCompanion: vi.fn<(_block: unknown, _ts: number, _idx: number) => Promise<any>>(
    (_block, _ts, _idx) => Promise.resolve(null),
  ),
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
  // opts is forwarded (not just accepted) so tests can assert on it — e.g. that
  // send.ts computes and passes `forceTableExtraction` correctly (10-3058).
  // The mock's return value is still controlled solely via
  // `mocks.detectAndExtract.mockReturnValue(...)` per test; forwarding opts
  // does not make the mock itself mode-aware.
  detectAndExtract: (t: string, opts?: unknown) => mocks.detectAndExtract(t, opts),
  writeTempVisualFile: (block: unknown) => mocks.writeTempVisualFile(block),
  renderMermaidCompanion: (block: unknown, ts: number, idx: number) =>
    mocks.renderMermaidCompanion(block, ts, idx),
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
    // Companion render default: returns null (no companion) — preserves all existing test behaviour
    mocks.renderMermaidCompanion.mockResolvedValue(null);
    // Explicitly reset persistent implementations that BLOCK-1 test overrides
    // (vi.clearAllMocks only clears call history, not implementations)
    mocks.hasInflightAudio.mockReturnValue(false);
    mocks.enqueueTextSend.mockImplementation((_sid: number, _fn: (pid: number) => Promise<void>): number => -2_000_000_001);

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
    expect(mocks.detectAndExtract).toHaveBeenCalledWith(
      "Use <svg> for diagrams.",
      expect.objectContaining({ deliveryMode: "follow-up" }),
    );
    expect(mocks.writeTempVisualFile).not.toHaveBeenCalled();
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  // ── SVG block detected ────────────────────────────────────────────────────

  it("SVG block (same-message): sendDocument called with prose as caption; no separate sendMessage", async () => {
    // Single block + short modified text → same-message delivery:
    // prose is sent as the document caption, no independent sendMessage call.
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
    // Same-message: no separate prose sendMessage
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    // Result comes from sendDocument (message_id=10), not sendMessage (42)
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
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

  it("Mermaid block (same-message): sendDocument called with prose as caption; no separate sendMessage", async () => {
    // Single block + short modified text → same-message delivery.
    const block = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });

    const result = await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
    // Same-message: no separate prose sendMessage
    expect(mocks.sendMessage).not.toHaveBeenCalled();
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

  // ── D-1 Ordering ─────────────────────────────────────────────────────────────

  it("D-1 ordering — follow-up (multiple blocks): sendMessage prose FIRST, then sendDocument per block", async () => {
    // Multiple blocks → follow-up delivery: prose must arrive BEFORE attachments.
    const callOrder: string[] = [];
    mocks.sendDocument.mockImplementation(() => {
      callOrder.push("doc");
      return Promise.resolve(SENT_DOC);
    });
    mocks.sendMessage.mockImplementation(() => {
      callOrder.push("msg");
      return Promise.resolve(SENT_MSG);
    });

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

    // Prose MUST arrive before all attachments (D-1 canonical rule)
    expect(callOrder).toEqual(["msg", "doc", "doc"]);
  });

  it("D-1 ordering — same-message (single block): only sendDocument called (prose is the caption)", async () => {
    // Single short block → same-message delivery: one sendDocument call, no sendMessage.
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

    // Same-message: prose delivered as document caption — no separate sendMessage
    expect(callOrder).toEqual(["doc"]);
  });

  // ── D-3 Placeholder wording in delivered prose ────────────────────────────

  it("D-3 same-message: sendDocument caption contains prose text (full prose as caption)", async () => {
    // Same-message delivery: the prose is sent as the document caption.
    // The block placeholder IS the prose (since detectAndExtract mock returns
    // modifiedText = block.placeholder, and all text transforms are identity).
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    // In same-message mode, sendDocument caption = the full transformed prose text.
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
    const [, , opts] = mocks.sendDocument.mock.calls[0] as [number, string, { caption?: string; parse_mode?: string }];
    expect(opts?.caption).toBe(block.placeholder); // prose = placeholder (identity transforms)
    expect(opts?.parse_mode).toBe("MarkdownV2");   // default parse_mode path
    // No separate prose sendMessage
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("D-3 follow-up: sendMessage prose sent first, then sendDocument with block placeholder as caption", async () => {
    // Multiple blocks → follow-up delivery. The prose message contains placeholders,
    // and each sendDocument receives its own block placeholder as the caption.
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

    // Prose FIRST (follow-up delivery)
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    // Each document sent after prose, each with its own placeholder as caption
    expect(mocks.sendDocument).toHaveBeenCalledTimes(2);
    const doc0opts = mocks.sendDocument.mock.calls[0]?.[2] as { caption?: string };
    const doc1opts = mocks.sendDocument.mock.calls[1]?.[2] as { caption?: string };
    expect(doc0opts?.caption).toBe(block1.placeholder);
    expect(doc1opts?.caption).toBe(block2.placeholder);
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

  // ── BLOCK-1: in-flight audio must NOT silently drop visual blocks ─────────

  it("BLOCK-1: in-flight audio — sendDocument still flushed after prose in queued lambda", async () => {
    const block = makeSvgBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block.placeholder,
      blocks: [block],
    });
    mocks.sendDocument.mockResolvedValue(SENT_DOC);

    // Simulate in-flight audio: enqueueTextSend captures the lambda without running it
    let capturedFn: ((pid: number) => Promise<void>) | undefined;
    mocks.hasInflightAudio.mockReturnValue(true);
    mocks.enqueueTextSend.mockImplementation((_sid: number, fn: (pid: number) => Promise<void>) => {
      capturedFn = fn;
      return -2_000_000_001;
    });

    await call({ text: "<svg><rect/></svg>", token: TOKEN });

    // Lambda must have been enqueued (in-flight audio path taken)
    expect(capturedFn).toBeDefined();

    // Drain the queue: simulate audio finishing and lambda executing
    await capturedFn!(-2_000_000_001);

    // BLOCK-1 regression: document must NOT be silently dropped
    expect(mocks.sendDocument).toHaveBeenCalled();
    // Prose must contain the placeholder, not the raw block content
    const proseArg = mocks.sendMessage.mock.calls[0]?.[1];
    expect(proseArg).toContain(block.placeholder);
    expect(proseArg).not.toContain(block.content);
  });

  // ── AC1: Mermaid block → companion SVG rendered and queued ───────────────

  it("AC1: mermaid block with successful render → companion SVG and .mmd both sent", async () => {
    const mmdBlock = makeMmdBlock();
    const companionBlock = {
      type: "svg" as const,
      content: '<svg width="100%"><rect/></svg>',
      placeholder: mmdBlock.placeholder,
      filename: "diagram-1-0.svg",
      companionCaption: "📊 rendered from diagram-1-0.mmd",
    };
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: mmdBlock.placeholder,
      blocks: [mmdBlock],
    });
    // Render returns companion on first call (for .mmd block)
    mocks.renderMermaidCompanion.mockResolvedValue(companionBlock);
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.mmd") // .mmd
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.svg"); // companion

    const result = await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    expect(isError(result)).toBe(false);
    // Both .mmd and companion SVG should be sent (2 documents total)
    // In follow-up delivery for 2 docs: prose first, then 2 sendDocument calls
    expect(mocks.sendDocument).toHaveBeenCalledTimes(2);
  });

  it("AC1: companion SVG caption is the companionCaption, not the placeholder", async () => {
    const mmdBlock = makeMmdBlock();
    const companionCaption = "📊 rendered from diagram-1-0.mmd";
    const companionBlock = {
      type: "svg" as const,
      content: '<svg width="100%"><rect/></svg>',
      placeholder: mmdBlock.placeholder,
      filename: "diagram-1-0.svg",
      companionCaption,
    };
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: `${mmdBlock.placeholder} text`,
      blocks: [mmdBlock],
    });
    mocks.renderMermaidCompanion.mockResolvedValue(companionBlock);
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.mmd")
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.svg");
    mocks.resolveMediaSource
      .mockReturnValueOnce({ source: "/tmp/telegram-bridge-mcp/diagram-1-0.mmd" })
      .mockReturnValueOnce({ source: "/tmp/telegram-bridge-mcp/diagram-1-0.svg" });

    await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    // Find the sendDocument call whose source matches the companion SVG path
    const svgCall = mocks.sendDocument.mock.calls.find(
      (c: unknown[]) => (c[1] as string) === "/tmp/telegram-bridge-mcp/diagram-1-0.svg",
    ) as [number, string, { caption?: string }] | undefined;
    expect(svgCall).toBeDefined();
    expect(svgCall![2]?.caption).toBe(companionCaption);
  });

  // ── AC2: mermaid block already accompanied by SVG → no render ────────────

  it("AC2: mermaid block whose stem already has a matching SVG block → renderMermaidCompanion NOT called", async () => {
    // Both blocks share the stem "diagram-1-0"
    const mmdBlock = makeMmdBlock(0); // filename: diagram-1-0.mmd
    const svgBlock = makeSvgBlock(0); // filename: diagram-1-0.svg — matching stem

    mocks.detectAndExtract.mockReturnValue({
      modifiedText: `${mmdBlock.placeholder} ${svgBlock.placeholder}`,
      blocks: [mmdBlock, svgBlock],
    });
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.mmd")
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/diagram-1-0.svg");

    await call({ text: "```mermaid\ngraph TD\nA-->B\n``` <svg/></svg>", token: TOKEN });

    // Companion render must NOT have been invoked (pre-existing SVG companion detected)
    expect(mocks.renderMermaidCompanion).not.toHaveBeenCalled();
  });

  // ── AC4: render failure → .mmd still delivered ────────────────────────────

  it("AC4: renderMermaidCompanion throws → .mmd still in pendingDocs, result not error", async () => {
    const mmdBlock = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: mmdBlock.placeholder,
      blocks: [mmdBlock],
    });
    mocks.renderMermaidCompanion.mockRejectedValue(new Error("render engine failed"));
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/diagram-1-0.mmd");

    const result = await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    expect(isError(result)).toBe(false);
    // .mmd must still be sent (graceful fallback — AC4 non-negotiable)
    expect(mocks.sendDocument).toHaveBeenCalled();
    const captionArg = (mocks.sendDocument.mock.calls[0] as [number, string, { caption?: string }])[2]?.caption;
    expect(captionArg).toBe(mmdBlock.placeholder);
  });

  it("AC4: renderMermaidCompanion returns null → .mmd still sent, no extra document", async () => {
    const mmdBlock = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: mmdBlock.placeholder,
      blocks: [mmdBlock],
    });
    // Default: renderMermaidCompanion returns null — already set in beforeEach

    const result = await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    expect(isError(result)).toBe(false);
    // Only .mmd sent (no companion)
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
  });

  // ── AC5: showTyping extended across render ─────────────────────────────────

  it("AC5: showTyping(30, upload_document) called during mermaid companion render", async () => {
    const mmdBlock = makeMmdBlock();
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: mmdBlock.placeholder,
      blocks: [mmdBlock],
    });

    await call({ text: "```mermaid\ngraph TD\nA-->B\n```", token: TOKEN });

    const renderTypingCalls = mocks.showTyping.mock.calls.filter(
      (c: unknown[]) => c[0] === 30 && c[1] === "upload_document",
    );
    expect(renderTypingCalls).toHaveLength(1);
  });

  // ── Table block integration (10-3058) ────────────────────────────────────
  // Text that triggers containsMarkdownTable (the pre-check in send.ts).
  // detectAndExtract is mocked to return the table block we want to test.

  // Helper: a table block fixture (type: "table")
  function makeTableBlock(index = 0) {
    return {
      type: "table" as const,
      content: "| A | B |\n| - | - |\n| 1 | 2 |\n",
      placeholder: `\n\`\`\`\n📋 [see following table·${index}]\n\`\`\``,
      filename: `table-123456789-${index}.md`,
    };
  }

  // A text containing a GFM table separator row — triggers containsMarkdownTable
  const TABLE_TEXT = "Summary:\n| A | B |\n| - | - |\n| 1 | 2 |";

  it("10-3058: table text triggers the pipeline pre-check — detectAndExtract called", async () => {
    // A markdown table separator row in the text triggers containsMarkdownTable,
    // which gates the visual pipeline (same as <svg> and ```mermaid checks).
    const result = await call({ text: TABLE_TEXT, token: TOKEN });
    expect(isError(result)).toBe(false);
    // Pre-check fires → detectAndExtract is called (even if no blocks returned)
    expect(mocks.detectAndExtract).toHaveBeenCalled();
  });

  it("10-3058: table block (follow-up) — prose sent FIRST via sendMessage, then sendDocument", async () => {
    // AC7: ordering — prose must precede the attachment in all modes
    const block = makeTableBlock();
    // Force follow-up: modifiedText.length > 1024 (caption limit)
    const longModText = "x".repeat(1100) + block.placeholder;
    mocks.detectAndExtract.mockReturnValue({ modifiedText: longModText, blocks: [block] });
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/table-123456789-0.md");
    mocks.resolveMediaSource.mockReturnValue({ source: "/tmp/telegram-bridge-mcp/table-123456789-0.md" });

    const callOrder: string[] = [];
    mocks.sendMessage.mockImplementation(() => { callOrder.push("msg"); return Promise.resolve(SENT_MSG); });
    mocks.sendDocument.mockImplementation(() => { callOrder.push("doc"); return Promise.resolve(SENT_DOC); });

    await call({ text: TABLE_TEXT, token: TOKEN });

    // Prose FIRST, document AFTER (AC7)
    expect(callOrder).toEqual(["msg", "doc"]);
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
  });

  it("10-3058: table block caption is '📋 table·N' in follow-up delivery", async () => {
    // AC7/AC8: sendDocument receives the table caption (not the placeholder)
    const block = makeTableBlock(0);
    const longModText = "x".repeat(1100) + block.placeholder;
    mocks.detectAndExtract.mockReturnValue({ modifiedText: longModText, blocks: [block] });
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/table-123456789-0.md");
    mocks.resolveMediaSource.mockReturnValue({ source: "/tmp/telegram-bridge-mcp/table-123456789-0.md" });

    await call({ text: TABLE_TEXT, token: TOKEN });

    const [, , opts] = mocks.sendDocument.mock.calls[0] as [number, string, { caption?: string }];
    expect(opts?.caption).toBe("📋 table·0");
  });

  it("10-3058: table block — writeTempVisualFile called with the table block", async () => {
    // AC11: reuse of writeTempVisualFile for table blocks (same infrastructure as SVG/mermaid)
    const block = makeTableBlock();
    const longModText = "x".repeat(1100) + block.placeholder;
    mocks.detectAndExtract.mockReturnValue({ modifiedText: longModText, blocks: [block] });

    await call({ text: TABLE_TEXT, token: TOKEN });

    expect(mocks.writeTempVisualFile).toHaveBeenCalledOnce();
    expect(mocks.writeTempVisualFile).toHaveBeenCalledWith(block);
  });

  it("10-3058: table block same-message: sendDocument called once with prose as caption", async () => {
    // AC8: same-message delivery uses prose as caption (single-block short text)
    const block = makeTableBlock();
    // Short modifiedText → same-message delivery
    mocks.detectAndExtract.mockReturnValue({ modifiedText: block.placeholder, blocks: [block] });
    mocks.writeTempVisualFile.mockResolvedValue("/tmp/telegram-bridge-mcp/table-123456789-0.md");
    mocks.resolveMediaSource.mockReturnValue({ source: "/tmp/telegram-bridge-mcp/table-123456789-0.md" });

    const result = await call({ text: TABLE_TEXT, token: TOKEN });

    expect(isError(result)).toBe(false);
    // Same-message: no separate prose sendMessage
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
  });

  it("10-3058: two table blocks → each sent as a separate document (AC9 pipeline side)", async () => {
    const block0 = makeTableBlock(0);
    const block1 = makeTableBlock(1);
    // 2 blocks → force follow-up delivery
    mocks.detectAndExtract.mockReturnValue({
      modifiedText: block0.placeholder + " " + block1.placeholder,
      blocks: [block0, block1],
    });
    mocks.writeTempVisualFile
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/table-123456789-0.md")
      .mockResolvedValueOnce("/tmp/telegram-bridge-mcp/table-123456789-1.md");
    mocks.resolveMediaSource
      .mockReturnValueOnce({ source: "/tmp/telegram-bridge-mcp/table-123456789-0.md" })
      .mockReturnValueOnce({ source: "/tmp/telegram-bridge-mcp/table-123456789-1.md" });

    await call({ text: TABLE_TEXT, token: TOKEN });

    expect(mocks.writeTempVisualFile).toHaveBeenCalledTimes(2);
    expect(mocks.sendDocument).toHaveBeenCalledTimes(2);
    // Prose sent first (follow-up ordering)
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("10-3058: graceful — table block writeTempVisualFile rejects → prose still sent", async () => {
    // Same graceful failure behaviour as SVG/mermaid
    const block = makeTableBlock();
    const longModText = "x".repeat(1100) + block.placeholder;
    mocks.detectAndExtract.mockReturnValue({ modifiedText: longModText, blocks: [block] });
    mocks.writeTempVisualFile.mockRejectedValue(new Error("disk full"));

    const result = await call({ text: TABLE_TEXT, token: TOKEN });

    expect(isError(result)).toBe(false);
    expect(mocks.sendDocument).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  // ── forceTableExtraction wiring (10-3058 "Gate trigger — constrained send
  // path") ─────────────────────────────────────────────────────────────────
  // These tests assert on the OPTIONS send.ts passes to detectAndExtract,
  // decoupled from the real regex/extraction engine (covered separately in
  // visual-attachment-pipeline.test.ts) — proving send.ts computes and
  // forwards `forceTableExtraction` correctly for each trigger condition.
  // detectAndExtract's mock implementation ignores opts (default passthrough,
  // zero blocks) — these tests only inspect what it was CALLED WITH, not what
  // it returns.

  it("10-3058: unconstrained small table → forceTableExtraction: false, single detectAndExtract call", async () => {
    await call({ text: TABLE_TEXT, token: TOKEN });
    expect(mocks.detectAndExtract).toHaveBeenCalledOnce();
    const [, opts] = mocks.detectAndExtract.mock.calls[0] as [string, { forceTableExtraction?: boolean }];
    expect(opts?.forceTableExtraction).toBe(false);
  });

  it("10-3058: effect flag → forceTableExtraction: true", async () => {
    await call({ text: TABLE_TEXT, effect: "fire", token: TOKEN });
    expect(mocks.detectAndExtract).toHaveBeenCalled();
    const [, opts] = mocks.detectAndExtract.mock.calls[0] as [string, { forceTableExtraction?: boolean }];
    expect(opts?.forceTableExtraction).toBe(true);
  });

  it("10-3058: in-flight audio → forceTableExtraction: true", async () => {
    mocks.hasInflightAudio.mockReturnValueOnce(true);
    await call({ text: TABLE_TEXT, token: TOKEN });
    expect(mocks.detectAndExtract).toHaveBeenCalled();
    const [, opts] = mocks.detectAndExtract.mock.calls[0] as [string, { forceTableExtraction?: boolean }];
    expect(opts?.forceTableExtraction).toBe(true);
  });

  it("10-3058: predicted multi-chunk → re-detects with forceTableExtraction: true (first pass unforced)", async () => {
    // Simulate "this message would need 2 chunks" for the predicted-multi-chunk
    // check (send.ts runs applyTopicToText/markdownToV2/splitMessage on the
    // first pass's modifiedText before deciding whether to force a re-detect).
    mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
    await call({ text: TABLE_TEXT, token: TOKEN });
    expect(mocks.detectAndExtract.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [, firstOpts] = mocks.detectAndExtract.mock.calls[0] as [string, { forceTableExtraction?: boolean }];
    expect(firstOpts?.forceTableExtraction).toBe(false);
    const lastCallArgs = mocks.detectAndExtract.mock.calls[mocks.detectAndExtract.mock.calls.length - 1];
    const [, lastOpts] = lastCallArgs as [string, { forceTableExtraction?: boolean }];
    expect(lastOpts?.forceTableExtraction).toBe(true);
  });
});
