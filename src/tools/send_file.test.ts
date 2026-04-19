import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendPhoto: vi.fn(),
  sendDocument: vi.fn(),
  sendVideo: vi.fn(),
  sendAudio: vi.fn(),
  sendVoiceDirect: vi.fn(),
  resolveMediaSource: vi.fn(),
  showTyping: vi.fn(),
  typingGeneration: vi.fn(() => 1),
  cancelTypingIfSameGeneration: vi.fn(() => true),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendPhoto: mocks.sendPhoto,
      sendDocument: mocks.sendDocument,
      sendVideo: mocks.sendVideo,
      sendAudio: mocks.sendAudio,
    }),
    resolveChat: () => 42,
    resolveMediaSource: mocks.resolveMediaSource,
    sendVoiceDirect: mocks.sendVoiceDirect,
  };
});

vi.mock("../typing-state.js", () => ({
  showTyping: mocks.showTyping,
  typingGeneration: mocks.typingGeneration,
  cancelTypingIfSameGeneration: mocks.cancelTypingIfSameGeneration,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./send_file.js";

describe("send_file tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.resolveMediaSource.mockReturnValue({ source: "/path/to/file" });
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_file");
  });

  // ---- Photo ----

  it("auto-detects photo by extension and sends", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 10, caption: "hi" });
    const result = await call({ file: "/img/photo.jpg", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.type).toBe("photo");
    expect(mocks.sendPhoto).toHaveBeenCalledOnce();
  });

  it("auto-detects .png as photo", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 11 });
    await call({ file: "/img/shot.png", token: 1123456});
    expect(mocks.sendPhoto).toHaveBeenCalledOnce();
  });

  // ---- Document ----

  it("auto-detects unknown extension as document", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 12,
      document: { file_id: "doc1", file_name: "report.pdf" },
    });
    const result = await call({ file: "/docs/report.pdf", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("document");
    expect(data.file_id).toBe("doc1");
  });

  // ---- Video ----

  it("auto-detects .mp4 as video", async () => {
    mocks.sendVideo.mockResolvedValue({
      message_id: 13,
      video: { file_id: "vid1", duration: 10 },
    });
    const result = await call({ file: "/vids/clip.mp4", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("video");
    expect(data.file_id).toBe("vid1");
  });

  // ---- Audio ----

  it("auto-detects .mp3 as audio", async () => {
    mocks.sendAudio.mockResolvedValue({
      message_id: 14,
      audio: { file_id: "aud1", title: "Song" },
    });
    const result = await call({ file: "/music/song.mp3", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("audio");
    expect(data.file_id).toBe("aud1");
  });

  // ---- Voice ----

  it("auto-detects .ogg as voice", async () => {
    mocks.sendVoiceDirect.mockResolvedValue({
      message_id: 15,
      voice: { file_id: "vce1" },
    });
    const result = await call({ file: "/audio/note.ogg", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("voice");
    expect(data.file_id).toBe("vce1");
  });

  // ---- Explicit type override ----

  it("sends as document when type is explicitly set, overriding extension", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 16,
      document: { file_id: "doc2", file_name: "image.jpg" },
    });
    const result = await call({ file: "/img/image.jpg", type: "document", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("document");
    expect(mocks.sendPhoto).not.toHaveBeenCalled();
  });

  // ---- Caption ----

  it("passes caption to the send method", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 17, caption: "Look!" });
    await call({ file: "/img/photo.jpg", caption: "Look!", token: 1123456});
    expect(mocks.sendPhoto).toHaveBeenCalledWith(
      42,
      "/path/to/file",
      expect.objectContaining({ caption: expect.any(String) }),
    );
  });

  // ---- resolveMediaSource error ----

  it("returns error when resolveMediaSource fails", async () => {
    mocks.resolveMediaSource.mockReturnValue({ code: "INVALID_SOURCE", message: "bad" });
    const result = await call({ file: "http://insecure.com/file.txt", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("INVALID_SOURCE");
  });

  // ---- API error ----

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendPhoto.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request" }, "sendPhoto", {}),
    );
    const result = await call({ file: "/img/photo.jpg", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(parseResult(result).warning).toBeUndefined();
  });

  // ---- reply_to ----

  it("passes reply_parameters for reply_to", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 21 });
    await call({ file: "/img/pic.jpg", reply_to: 3, token: 1123456});
    expect(mocks.sendPhoto).toHaveBeenCalledWith(
      42,
      "/path/to/file",
      expect.objectContaining({
        reply_parameters: { message_id: 3 },
      }),
    );
  });

  // =========================================================================
  // Issue #11 — http:// should be rejected for voice too
  // =========================================================================

  it("rejects http:// URL for voice type (#11)", async () => {
    // resolveMediaSource should be called for voice too,
    // and http:// should be rejected
    mocks.resolveMediaSource.mockReturnValue({
      code: "UNKNOWN",
      message: "Plain HTTP URLs are not accepted",
    });
    const result = await call({
      file: "http://evil.com/voice.ogg",
      type: "voice", token: 1123456});
    expect(isError(result)).toBe(true);
  });

  // ---- CDN warning ----

  describe("CDN persistence warning", () => {
    const WARNING_TEXT =
      "File persists on Telegram CDN indefinitely. Deleting the message does NOT delete the file. " +
      "Do not send Tier 2/3 content via send_file.";

    it("includes warning field in photo response", async () => {
      mocks.sendPhoto.mockResolvedValue({ message_id: 30, caption: undefined });
      const result = await call({ file: "/img/photo.jpg", token: 1123456 });
      expect(isError(result)).toBe(false);
      expect(parseResult(result).warning).toBe(WARNING_TEXT);
    });

    it("includes warning field in document response", async () => {
      mocks.sendDocument.mockResolvedValue({
        message_id: 31,
        document: { file_id: "doc99", file_name: "file.txt" },
      });
      const result = await call({ file: "/docs/file.txt", token: 1123456 });
      expect(isError(result)).toBe(false);
      expect(parseResult(result).warning).toBe(WARNING_TEXT);
    });

    it("includes warning field in video response", async () => {
      mocks.sendVideo.mockResolvedValue({
        message_id: 32,
        video: { file_id: "vid99", duration: 5 },
      });
      const result = await call({ file: "/vids/clip.mp4", token: 1123456 });
      expect(isError(result)).toBe(false);
      expect(parseResult(result).warning).toBe(WARNING_TEXT);
    });

    it("includes warning field in audio response", async () => {
      mocks.sendAudio.mockResolvedValue({
        message_id: 33,
        audio: { file_id: "aud99", title: undefined },
      });
      const result = await call({ file: "/music/track.mp3", token: 1123456 });
      expect(isError(result)).toBe(false);
      expect(parseResult(result).warning).toBe(WARNING_TEXT);
    });

    it("includes warning field in voice response", async () => {
      mocks.sendVoiceDirect.mockResolvedValue({
        message_id: 34,
        voice: { file_id: "vce99" },
      });
      const result = await call({ file: "/audio/note.ogg", token: 1123456 });
      expect(isError(result)).toBe(false);
      expect(parseResult(result).warning).toBe(WARNING_TEXT);
    });

    it("does NOT include warning field on error response", async () => {
      mocks.resolveMediaSource.mockReturnValue({ code: "INVALID_SOURCE", message: "bad" });
      const result = await call({ file: "http://insecure.com/bad.txt", token: 1123456 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).warning).toBeUndefined();
    });
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({"file":"x"});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({"file":"x","token": 1099999});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({"file":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });

  });

});

describe("send_file — voice non-blocking timing", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.resolveMediaSource.mockReturnValue({ source: "/path/to/file" });
    mocks.sendVoiceDirect.mockResolvedValue({
      message_id: 99,
      voice: { file_id: "vce99" },
    });
    mocks.typingGeneration.mockReturnValue(42);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_file");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("voice send resolves without waiting for typing cancel timer", async () => {
    const start = Date.now();
    const result = await call({ file: "/audio/note.ogg", token: 1123456 });
    const elapsed = Date.now() - start;
    expect(isError(result)).toBe(false);
    // Must resolve near-instantly — no 3s blocking sleep
    expect(elapsed).toBeLessThan(500);
    // cancelTypingIfSameGeneration not yet called (timer still pending)
    expect(mocks.cancelTypingIfSameGeneration).not.toHaveBeenCalled();
    // Advance past the 1s timer
    await vi.advanceTimersByTimeAsync(1100);
    expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledWith(42);
  });

  it("voice send cancels typing immediately on API failure", async () => {
    mocks.sendVoiceDirect.mockRejectedValue(new Error("api error"));
    const result = await call({ file: "/audio/note.ogg", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledWith(42);
  });
});
