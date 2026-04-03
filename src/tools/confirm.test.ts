import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { ButtonResult, TextResult, VoiceResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
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
  validateSession: mocks.validateSession,
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => sid === 1 ? mocks.sessionQueue : undefined,
  peekSessionCategories: (sid: number) => mocks.peekSessionCategories(sid),
}));

import { register } from "./confirm.js";

const SENT_MSG = { message_id: 5, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return { kind: "button", callback_query_id: "cq1", data, message_id: 5 };
}

describe("confirm tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithSkipped.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("confirm");
  });

  it("returns confirmed:true when Yes is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    const result = await call({ text: "Proceed?", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.confirmed).toBe(true);
    expect(data.value).toBe("confirm_yes");
    expect(data.message_id).toBe(5);
  });

  it("returns confirmed:false when No is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_no"));
    const result = await call({ text: "Delete everything?", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(false);
    expect(data.value).toBe("confirm_no");
  });

  it("registers a callback hook for the sent message", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456});
    expect(mocks.registerCallbackHook).toHaveBeenCalledWith(5, expect.any(Function), expect.any(Number));
  });

  it("calls ackAndEditSelection when hook fires", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456});
    // Simulate the hook being called (as message-store would)
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_yes", qid: "cq1" } });
    // Wait for async void in hook
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 5, "Proceed?", "OK", "cq1",
    );
  });

  it("keeps buttons live on timeout (no editWithTimedOut)", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ text: "Proceed?", token: 1123456});
    // Hook stays registered — no edit, no button removal
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
  });

  it("hook shows No label when No is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_no"));
    await call({ text: "Proceed?", yes_text: "✔️ Yes", no_text: "✖️ No", token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_no", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 5, "Proceed?", "✖️ No", "cq1",
    );
  });

  it("respects custom yes_data and no_data", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("approve"));
    const result = await call({ text: "Approve?", yes_data: "approve", no_data: "reject", token: 1123456});
    const data = parseResult(result);
    expect(data.confirmed).toBe(true);
    expect(data.value).toBe("approve");
  });

  it("defaults to OK / Cancel button labels", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456 });
    const sendOpts = mocks.sendMessage.mock.calls[0][2];
    const buttons = sendOpts.reply_markup.inline_keyboard[0];
    expect(buttons[0].text).toBe("OK");
    expect(buttons[0].style).toBe("primary");
    expect(buttons[1].text).toBe("Cancel");
    expect(buttons[1].style).toBeUndefined();
  });

  it("returns timed_out:true when no response arrives", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const result = await call({ text: "Proceed?", token: 1123456});
    const data = parseResult(result);
    expect(data.timed_out).toBe(true);
    // Hook stays registered for late clicks — no ack, no edit
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
  });

  it("returns skipped when user sends text instead of pressing a button", async () => {
    const textResult: TextResult = { kind: "text", message_id: 10, text: "just do it" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(textResult);
    const result = await call({ text: "Proceed?", token: 1123456});
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("just do it");
    expect(data.text_message_id).toBe(10);
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 5, "Proceed?");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(5);
  });

  it("returns skipped when user sends voice instead of pressing a button", async () => {
    const voiceResult: VoiceResult = { kind: "voice", message_id: 11, text: "yes do it" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(voiceResult);
    const result = await call({ text: "Proceed?", token: 1123456});
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("yes do it");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(5);
  });

  it("returns error when sendMessage throws", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("Network error"));
    const result = await call({ text: "Proceed?", token: 1123456});
    expect(isError(result)).toBe(true);
  });

  it("sends with a reply_to_message_id when provided", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", reply_to_message_id: 3, token: 1123456});
    const sendOpts = mocks.sendMessage.mock.calls[0][2];
    expect(sendOpts.reply_parameters).toEqual({ message_id: 3 });
  });

  it("registers a message hook on timeout to clean up stale buttons", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ text: "Proceed?", token: 1123456});
    expect(mocks.registerMessageHook).toHaveBeenCalledWith(5, expect.any(Function));
  });

  it("message hook clears callback hook and edits with skipped", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ text: "Proceed?", token: 1123456});
    const hookFn = mocks.registerMessageHook.mock.calls[0][1];
    hookFn();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(5);
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 5, "Proceed?");
  });

  it("callback hook clears message hook on late button press", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_yes", qid: "cq1" } });
    expect(mocks.clearMessageHook).toHaveBeenCalledWith(5);
  });

  it("returns skipped with command when a slash command interrupts", async () => {
    const commandResult = { kind: "command", message_id: 6, command: "/start", args: "" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(commandResult);
    const result = await call({ text: "Proceed?", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.command).toBe("/start");
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 5, "Proceed?");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(5);
  });

  it("single-button CTA: hook ignores button presses that don't match yes_data", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Continue?", no_text: "", token: 1123456});
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    // Fire hook with a value that isn't yes_data — guard should short-circuit
    hookFn({ content: { data: "rogue_data", qid: "cq-rogue" } });
    await new Promise((r) => setTimeout(r, 0));
    // ackAndEditSelection was NOT called (hook returned early due to CTA guard)
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
  });

  it("callback hook handles ackAndEditSelection failures gracefully", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456});
    // Make ackAndEditSelection reject on the next call (simulates network error)
    mocks.ackAndEditSelection.mockRejectedValueOnce(new Error("network"));
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_yes", qid: "cq1" } });
    // Wait for the void+catch chain to settle
    await new Promise((r) => setTimeout(r, 20));
    // No unhandled rejection — .catch swallowed the error gracefully
    expect(mocks.ackAndEditSelection).toHaveBeenCalled();
  });

  it("calls editWithSkipped immediately via onVoiceDetected before poll resolves", async () => {
    const voiceResult: VoiceResult = { kind: "voice", message_id: 11, text: "do it" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockImplementation((...args: unknown[]) => {
      const onVoiceDetected = args[3] as () => void;
      onVoiceDetected(); // fires immediately — simulates early voice detection
      return Promise.resolve(voiceResult);
    });
    const result = await call({ text: "Proceed?", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    // editWithSkipped called by onVoiceDetected
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 5, "Proceed?");
    // Should NOT be called a second time because editState.done = true
    expect(mocks.editWithSkipped).toHaveBeenCalledTimes(1);
  });

  it("rejects with PENDING_UPDATES when session queue is non-empty", async () => {
    // _sid=1 resolves to mocks.sessionQueue — check that queue's pending count
    mocks.sessionQueue.pendingCount.mockReturnValue(3);
    const result = await call({ text: "Proceed?", token: 1123456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(3);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("enriches PENDING_UPDATES with breakdown when session queue is available", async () => {
    mocks.getActiveSession.mockReturnValue(1);
    mocks.sessionQueue.pendingCount.mockReturnValueOnce(3);
    mocks.peekSessionCategories.mockReturnValueOnce({ text: 1, reaction: 2 });
    const result = await call({ text: "Proceed?", token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("PENDING_UPDATES");
    expect(data.pending).toBe(3);
    expect(data.breakdown).toEqual({ text: 1, reaction: 2 });
    expect(data.message).toContain("1 text");
    expect(data.message).toContain("2 reaction");
    expect(data.message).toContain("ignore_pending: true");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("proceeds when ignore_pending is true despite pending updates", async () => {
    mocks.pendingCount.mockReturnValue(3);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(
      makeButtonResult("confirm_yes"),
    );
    const result = await call({
      text: "Proceed?",
      ignore_pending: true, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(true);
  });

  it("bypasses pending guard when reply_to_message_id is set", async () => {
    mocks.pendingCount.mockReturnValue(3);
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(
      makeButtonResult("confirm_yes"),
    );
    const result = await call({
      text: "Proceed?",
      reply_to_message_id: 42, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"text":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"text":"x","token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"text":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});

describe("confirmYN tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithSkipped.mockResolvedValue(undefined);
    mocks.sessionQueue.pendingCount.mockReturnValue(0);
    const server = createMockServer();
    register(server);
    call = server.getHandler("confirmYN");
  });

  it("defaults to 🟢 Yes / 🔴 No labels", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Are you sure?", token: 1123456 });
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_yes", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 5, "Are you sure?", "🟢 Yes", "cq1",
    );
  });

  it("hook shows 🔴 No label when No is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_no"));
    await call({ text: "Are you sure?", token: 1123456 });
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_no", qid: "cq1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 5, "Are you sure?", "🔴 No", "cq1",
    );
  });

  it("returns confirmed:true when Yes is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    const result = await call({ text: "Proceed?", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(true);
    expect(data.value).toBe("confirm_yes");
  });

  it("returns confirmed:false when No is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_no"));
    const result = await call({ text: "Proceed?", token: 1123456 });
    const data = parseResult(result);
    expect(data.confirmed).toBe(false);
  });

  it("sends buttons without yes_style by default", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", token: 1123456 });
    const sendOpts = mocks.sendMessage.mock.calls[0][2];
    const yesButton = sendOpts.reply_markup.inline_keyboard[0][0];
    expect(yesButton.text).toBe("🟢 Yes");
    expect(yesButton.style).toBeUndefined();
  });

  it("accepts custom yes_text and no_text overrides", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", yes_text: "✔️ Yep", no_text: "✖️ Nope", token: 1123456 });
    const sendOpts = mocks.sendMessage.mock.calls[0][2];
    const buttons = sendOpts.reply_markup.inline_keyboard[0];
    expect(buttons[0].text).toBe("✔️ Yep");
    expect(buttons[1].text).toBe("✖️ Nope");
  });

});
