import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { ButtonResult, TextResult, VoiceResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  pollButtonOrTextOrVoice: vi.fn(),
  ackAndEditSelection: vi.fn(),
  editWithSkipped: vi.fn(),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
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
  registerCallbackHook: (...args: unknown[]) => mocks.registerCallbackHook(...args),
  clearCallbackHook: (...args: unknown[]) => mocks.clearCallbackHook(...args),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonOrTextOrVoice: (...args: unknown[]) => mocks.pollButtonOrTextOrVoice(...args),
    ackAndEditSelection: (...args: unknown[]) => mocks.ackAndEditSelection(...args),
    editWithSkipped: (...args: unknown[]) => mocks.editWithSkipped(...args),
  };
});

import { register } from "./send_confirmation.js";

const SENT_MSG = { message_id: 5, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return { kind: "button", callback_query_id: "cq1", data, message_id: 5 };
}

describe("send_confirmation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithSkipped.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_confirmation");
  });

  it("returns confirmed:true when Yes is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    const result = await call({ text: "Proceed?" });
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
    const result = await call({ text: "Delete everything?" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(false);
    expect(data.value).toBe("confirm_no");
  });

  it("registers a callback hook for the sent message", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?" });
    expect(mocks.registerCallbackHook).toHaveBeenCalledWith(5, expect.any(Function));
  });

  it("calls ackAndEditSelection when hook fires", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?" });
    // Simulate the hook being called (as message-store would)
    const hookFn = mocks.registerCallbackHook.mock.calls[0][1];
    hookFn({ content: { data: "confirm_yes", qid: "cq1" } });
    // Wait for async void in hook
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 5, "Proceed?", "🟢 Yes", "cq1",
    );
  });

  it("keeps buttons live on timeout (no editWithTimedOut)", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ text: "Proceed?" });
    // Hook stays registered — no edit, no button removal
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
  });

  it("hook shows No label when No is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_no"));
    await call({ text: "Proceed?", yes_text: "✔️ Yes", no_text: "✖️ No" });
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
    const result = await call({ text: "Approve?", yes_data: "approve", no_data: "reject" });
    const data = parseResult(result);
    expect(data.confirmed).toBe(true);
    expect(data.value).toBe("approve");
  });

  it("returns timed_out:true when no response arrives", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const result = await call({ text: "Proceed?" });
    const data = parseResult(result);
    expect(data.timed_out).toBe(true);
    // Hook stays registered for late clicks — no ack, no edit
    expect(mocks.ackAndEditSelection).not.toHaveBeenCalled();
  });

  it("returns skipped when user sends text instead of pressing a button", async () => {
    const textResult: TextResult = { kind: "text", message_id: 10, text: "just do it" };
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(textResult);
    const result = await call({ text: "Proceed?" });
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
    const result = await call({ text: "Proceed?" });
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("yes do it");
    expect(mocks.clearCallbackHook).toHaveBeenCalledWith(5);
  });

  it("returns error when sendMessage throws", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("Network error"));
    const result = await call({ text: "Proceed?" });
    expect(isError(result)).toBe(true);
  });

  it("sends with a reply_to_message_id when provided", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("confirm_yes"));
    await call({ text: "Proceed?", reply_to_message_id: 3 });
    const sendOpts = mocks.sendMessage.mock.calls[0][2];
    expect(sendOpts.reply_parameters).toEqual({ message_id: 3 });
  });
});
