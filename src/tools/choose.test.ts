import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { ButtonResult, TextResult, VoiceResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn((_sid: number, _pin: number) => false),
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  pollButtonOrTextOrVoice: vi.fn(),
  ackAndEditSelection: vi.fn(),
  editWithSkipped: vi.fn(),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  registerMessageHook: vi.fn(),
  clearMessageHook: vi.fn(),
  pendingCount: vi.fn().mockReturnValue(0),
  sessionQueue: {
    pendingCount: vi.fn(() => 0),
  },
  peekSessionCategories: vi.fn((_sid: number) => undefined as Record<string, number> | undefined),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: () => 42,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: () => mocks.pendingCount(),
  registerCallbackHook: mocks.registerCallbackHook,
  clearCallbackHook: mocks.clearCallbackHook,
  registerMessageHook: mocks.registerMessageHook,
  clearMessageHook: mocks.clearMessageHook,
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    pollButtonOrTextOrVoice: mocks.pollButtonOrTextOrVoice,
    ackAndEditSelection: mocks.ackAndEditSelection,
    editWithSkipped: mocks.editWithSkipped,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (sid: number, pin: number) => mocks.validateSession(sid, pin),
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => sid === 1 ? mocks.sessionQueue : undefined,
  peekSessionCategories: (sid: number) => mocks.peekSessionCategories(sid),
}));

import { register } from "./choose.js";

const SENT_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return { kind: "button", callback_query_id: "cq1", data, message_id: 7 };
}

function makeTextResult(messageId: number, text: string): TextResult {
  return { kind: "text", message_id: messageId, text };
}

function makeVoiceResult(messageId: number, text: string): VoiceResult {
  return { kind: "voice", message_id: messageId, text };
}

describe("choose tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const OPTIONS = [
    { label: "Option A", value: "opt_a" },
    { label: "Option B", value: "opt_b" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithSkipped.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("choose");
  });

  it("returns chosen label and value", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_a"));
    const result = await call({ question: "Pick one", options: OPTIONS, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.value).toBe("opt_a");
    expect(data.label).toBe("Option A");
  });

  it("registers a callback hook for the sent message", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_b"));
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    expect(mocks.registerCallbackHook).toHaveBeenCalledWith(7, expect.any(Function), expect.any(Number));
  });

  it("calls ackAndEditSelection when hook fires", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_b"));
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "opt_b", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 7, "Pick", "Option B", "cq1",
    );
  });

  it("hook shows correct label via ackAndEditSelection", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_a"));
    await call({ question: "Pick one", options: OPTIONS, token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "opt_a", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 7, "Pick one", "Option A", "cq1",
    );
  });

  it("keeps buttons live on timeout (hook handles late clicks)", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1, token: 1123456});
    // No edit on timeout — buttons stay live for the hook
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
    expect(mocks.editWithSkipped).not.toHaveBeenCalled();
  });

  it("returns timed_out when no button is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1, token: 1123456});
    expect((parseResult(result)).timed_out).toBe(true);
  });

  it("validates question text", async () => {
    const result = await call({ question: "", options: OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
  });

  it("rejects callback_data over 64 bytes", async () => {
    const badOptions = [
      { label: "A", value: "a".repeat(65) },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: badOptions, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("rejects label over 20 chars for 2-column layout", async () => {
    const longOptions = [
      { label: "A very long label text", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 2, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_TOO_LONG");
  });

  it("allows label up to 35 chars for single-column layout", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const longOptions = [
      { label: "A somewhat longer label text ok", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 1, timeout_seconds: 1, token: 1123456});
    expect(isError(result)).toBe(false);
  });

  it("builds keyboard rows with correct column count", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const threeOptions = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
      { label: "C", value: "c" },
    ];
    await call({ question: "Pick", options: threeOptions, columns: 3, timeout_seconds: 1, token: 1123456});
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    // All 3 options in a single row when columns=3
    expect(opts.reply_markup.inline_keyboard[0]).toHaveLength(3);
  });

  it("returns skipped with text when user types instead of pressing button", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeTextResult(20, "hello"));
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1, token: 1123456});
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("hello");
    expect(data.text_message_id).toBe(20);
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(7);
  });

  it("returns skipped with voice transcription when user sends a voice message", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeVoiceResult(20, "transcribed text"));
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456});
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.voice).toBe(true);
    expect(data.text_response).toBe("transcribed text");
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(7);
  });

  it("returns error when sendMessage throws", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("Network error"));
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
  });

  it("registers a message hook on timeout to clean up stale buttons", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    expect(mocks.registerMessageHook).toHaveBeenCalledWith(7, expect.any(Function));
  });

  it("message hook clears callback hook and edits with skipped", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    const hookFn = mocks.registerMessageHook.mock.calls[0][1];
    hookFn();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(7);
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
  });

  it("callback hook clears message hook on late button press", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("a"));
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "a", qid: "cq1" } });
    expect(mocks.clearMessageHook).toHaveBeenCalledWith(7);
  });

  it("returns skipped with command when a slash command interrupts", async () => {
    const commandResult = { kind: "command", message_id: 8, command: "/help", args: "fast" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(commandResult);
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.command).toBe("/help");
    expect(data.args).toBe("fast");
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(7);
  });

  it("calls editWithSkipped immediately via onVoiceDetected before poll resolves", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockImplementation((...args: unknown[]) => {
      const onVoiceDetected = args[3] as () => void;
      onVoiceDetected();
      return Promise.resolve(makeVoiceResult(20, "pick the second one"));
    });
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456});
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.voice).toBe(true);
    // editWithSkipped called exactly once (by onVoiceDetected, not again by handler)
    expect(mocks.editWithSkipped).toHaveBeenCalledTimes(1);
  });

  it("callback hook handles ackAndEditSelection failures gracefully", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_a"));
    await call({ question: "Pick", options: OPTIONS, token: 1123456});
    mocks.ackAndEditSelection.mockRejectedValueOnce(new Error("network"));
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "opt_a", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 20));
    // No unhandled rejection — .catch swallowed the error gracefully
    expect(mocks.ackAndEditSelection).toHaveBeenCalled();
  });

  it("rejects with PENDING_UPDATES when queue is non-empty", async () => {
    mocks.pendingCount.mockReturnValue(2);
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(2);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("enriches PENDING_UPDATES with breakdown when session queue is available", async () => {
    mocks.getActiveSession.mockReturnValue(1);
    mocks.sessionQueue.pendingCount.mockReturnValueOnce(3);
    mocks.peekSessionCategories.mockReturnValueOnce({ text: 1, callback: 2 });
    const result = await call({ question: "Pick", options: OPTIONS, token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(3);
    expect(data.breakdown).toEqual({ text: 1, callback: 2 });
    expect(data.message).toContain("1 text");
    expect(data.message).toContain("2 callback");
    expect(data.message).toContain("ignore_pending: true");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("proceeds when ignore_pending is true despite pending updates", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(
      makeButtonResult("opt_a"),
    );
    const result = await call({
      question: "Pick",
      options: OPTIONS,
      ignore_pending: true, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.label).toBe("Option A");
  });

  it("bypasses pending guard when reply_to_message_id is set", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(
      makeButtonResult("opt_b"),
    );
    const result = await call({
      question: "Pick",
      options: OPTIONS,
      reply_to_message_id: 55, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.label).toBe("Option B");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"question":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"question":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}],"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"question":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}],"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
