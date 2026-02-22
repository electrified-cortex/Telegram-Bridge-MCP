import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(), sendVoiceDirect: vi.fn() }));
const ttsMocks = vi.hoisted(() => ({
  isTtsEnabled: vi.fn(() => false),
  synthesizeToOgg: vi.fn(),
  stripForTts: vi.fn((t: string) => t),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, sendVoiceDirect: mocks.sendVoiceDirect, resolveChat: () => "123" };
});

vi.mock("../tts.js", () => ({
  isTtsEnabled: ttsMocks.isTtsEnabled,
  synthesizeToOgg: ttsMocks.synthesizeToOgg,
  stripForTts: ttsMocks.stripForTts,
}));

import { register } from "./send_message.js";

describe("send_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    ttsMocks.isTtsEnabled.mockReturnValue(false);
    ttsMocks.stripForTts.mockImplementation((t: string) => t);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_message");
  });

  it("sends a message and returns message_id and chat_id", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 123 }, date: 1000, text: "hi" });
    const result = await call({ text: "hi" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.message_id).toBe(1);
    expect(data.chat_id).toBeUndefined();
  });

  it("defaults parse_mode to Markdown, sends as MarkdownV2", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 2, chat: { id: 1 }, date: 0, text: "x" });
    await call({ text: "hello world" });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("auto-escapes plain text in Markdown mode", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 2, chat: { id: 1 }, date: 0, text: "" });
    await call({ text: "Done. Save!" });
    const [, sentText] = mocks.sendMessage.mock.calls[0];
    expect(sentText).toBe("Done\\. Save\\!");
  });

  it("passes explicit parse_mode HTML to API", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 2, chat: { id: 1 }, date: 0, text: "x" });
    await call({ text: "x", parse_mode: "HTML" });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("HTML");
  });

  it("passes explicit parse_mode MarkdownV2 unchanged", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 2, chat: { id: 1 }, date: 0, text: "x" });
    await call({ text: "*hi*", parse_mode: "MarkdownV2" });
    const [, sentText, opts] = mocks.sendMessage.mock.calls[0];
    expect(sentText).toBe("*hi*");
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("returns EMPTY_MESSAGE without calling API", async () => {
    const result = await call({ text: "" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("auto-splits text over 4096 chars into multiple messages", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "x" });
    const result = await call({ text: "a".repeat(5000) });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.split).toBe(true);
    expect(Array.isArray(data.message_ids)).toBe(true);
    expect(mocks.sendMessage.mock.calls.length).toBeGreaterThan(1);
  });

  it("maps CHAT_NOT_FOUND from GrammyError", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "sendMessage", {})
    );
    const result = await call({ text: "hi" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Voice mode (TTS)
// ---------------------------------------------------------------------------

describe("send_message tool — voice mode", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    ttsMocks.isTtsEnabled.mockReturnValue(false);
    ttsMocks.stripForTts.mockImplementation((t: string) => t);
    ttsMocks.synthesizeToOgg.mockResolvedValue(Buffer.from("fakeaudio"));
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 99, voice: { file_id: "f1", duration: 1, file_size: 9, mime_type: "audio/ogg" } });
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_message");
  });

  it("sends via sendVoiceDirect when voice:true is explicitly passed", async () => {
    const result = await call({ text: "Hello!", voice: true });
    expect(isError(result)).toBe(false);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    const data = parseResult(result) as any;
    expect(data.message_id).toBe(99);
    expect(data.voice).toBe(true);
  });

  it("uses sendMessage (not sendVoice) when voice:false overrides TTS default", async () => {
    ttsMocks.isTtsEnabled.mockReturnValue(true);
    mocks.sendMessage.mockResolvedValue({ message_id: 5, chat: { id: 1 }, date: 0, text: "x" });
    const result = await call({ text: "hi", voice: false });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  it("uses sendVoiceDirect by default when isTtsEnabled returns true", async () => {
    ttsMocks.isTtsEnabled.mockReturnValue(true);
    const result = await call({ text: "hello" });
    expect(isError(result)).toBe(false);
    expect(mocks.sendVoiceDirect).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("strips formatting before synthesis", async () => {
    ttsMocks.stripForTts.mockReturnValue("plain stripped text");
    await call({ text: "**bold** _text_", voice: true });
    expect(ttsMocks.stripForTts).toHaveBeenCalledWith("**bold** _text_");
    expect(ttsMocks.synthesizeToOgg).toHaveBeenCalledWith("plain stripped text");
  });

  it("returns EMPTY_MESSAGE when stripped text is empty", async () => {
    ttsMocks.stripForTts.mockReturnValue("");
    const result = await call({ text: "**formatting only**", voice: true });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  it("propagates synthesis errors", async () => {
    ttsMocks.synthesizeToOgg.mockRejectedValue(new Error("OPENAI_API_KEY"));
    const result = await call({ text: "hi", voice: true });
    expect(isError(result)).toBe(true);
  });
});
