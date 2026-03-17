import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  resolveChat: vi.fn((): number | string => 123),
  validateText: vi.fn((): null | object => null),
  splitMessage: vi.fn((t: string) => [t]),
  sendVoiceDirect: vi.fn(),
  showTyping: vi.fn(),
  cancelTyping: vi.fn(),
  isTtsEnabled: vi.fn((): boolean => true),
  stripForTts: vi.fn((t: string) => t),
  synthesizeToOgg: vi.fn(),
  registerTool: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
    splitMessage: mocks.splitMessage,
    sendVoiceDirect: mocks.sendVoiceDirect,
    toResult: actual.toResult,
    toError: actual.toError,
  };
});

vi.mock("../typing-state.js", () => ({
  showTyping: mocks.showTyping,
  cancelTyping: mocks.cancelTyping,
}));

vi.mock("../tts.js", () => ({
  isTtsEnabled: mocks.isTtsEnabled,
  stripForTts: mocks.stripForTts,
  synthesizeToOgg: mocks.synthesizeToOgg,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

import { register } from "./send_text_as_voice.js";

// ---------------------------------------------------------------------------
// Grab the handler from the registration
// ---------------------------------------------------------------------------

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
let handler: Handler;

function setupHandler() {
  const server = { registerTool: mocks.registerTool };
  register(server as never);
  handler = mocks.registerTool.mock.calls[0][2] as Handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("send_text_as_voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveChat.mockReturnValue(123);
    mocks.isTtsEnabled.mockReturnValue(true);
    mocks.validateText.mockReturnValue(null);
    mocks.stripForTts.mockImplementation((t: string) => t);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg"));
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 42 });
    setupHandler();
  });

  it("registers the tool", () => {
    expect(mocks.registerTool).toHaveBeenCalledWith(
      "send_text_as_voice",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns error when resolveChat is non-number", async () => {
    mocks.resolveChat.mockReturnValue("not configured");
    const result = await handler({ text: "hello" }) as { content: unknown[] };
    expect(result.content[0]).toHaveProperty("text");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when TTS is not configured", async () => {
    mocks.isTtsEnabled.mockReturnValue(false);
    const result = await handler({ text: "hello" }) as { content: { text: string }[] };
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("TTS_NOT_CONFIGURED");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValue({ code: "INVALID", message: "bad" });
    const result = await handler({ text: "" }) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
  });

  it("returns error when stripped text is empty", async () => {
    mocks.stripForTts.mockReturnValue("");
    const result = await handler({ text: "***" }) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("EMPTY_MESSAGE");
  });

  it("synthesizes and sends a single voice note", async () => {
    const result = await handler({ text: "Hello world" }) as { content: { text: string }[] };
    expect(mocks.showTyping).toHaveBeenCalled();
    expect(mocks.synthesizeToOgg).toHaveBeenCalledWith("Hello world", undefined);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledWith(
      123,
      Buffer.from("ogg"),
      { disable_notification: undefined, reply_to_message_id: undefined },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message_id).toBe(42);
    expect(parsed.voice).toBe(true);
  });

  it("sends multiple chunks when text is split", async () => {
    mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
    mocks.sendVoiceDirect
      .mockResolvedValueOnce({ message_id: 10 })
      .mockResolvedValueOnce({ message_id: 11 });
    const result = await handler({ text: "long text" }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message_ids).toEqual([10, 11]);
    expect(parsed.split).toBe(true);
  });

  it("passes reply_to_message_id only to first chunk", async () => {
    mocks.splitMessage.mockReturnValue(["a", "b"]);
    mocks.sendVoiceDirect
      .mockResolvedValueOnce({ message_id: 10 })
      .mockResolvedValueOnce({ message_id: 11 });
    await handler({ text: "test", reply_to_message_id: 5 });
    expect(mocks.sendVoiceDirect.mock.calls[0][2]).toMatchObject({
      reply_to_message_id: 5,
    });
    expect(mocks.sendVoiceDirect.mock.calls[1][2]).toMatchObject({
      reply_to_message_id: undefined,
    });
  });

  it("returns VOICE_RESTRICTED error", async () => {
    mocks.sendVoiceDirect.mockRejectedValue(
      new Error("user restricted receiving of voice note messages"),
    );
    const result = await handler({ text: "hi" }) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("VOICE_RESTRICTED");
  });

  it("returns generic error for other failures", async () => {
    mocks.synthesizeToOgg.mockRejectedValue(new Error("network"));
    const result = await handler({ text: "hi" }) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when multiple sessions active and no identity", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    const result = await handler({"text":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await handler({"text":"x","identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when multiple sessions active and identity is valid", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await handler({"text":"x","identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

  it("proceeds when single session active and no identity (backward compat)", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(1);
    let code: string | undefined;
    try { code = errorCode(await handler({"text":"x"})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
  });
});

});
