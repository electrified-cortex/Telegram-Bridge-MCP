import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendPhoto: vi.fn(),
  sendDocument: vi.fn(),
  sendVideo: vi.fn(),
  sendAudio: vi.fn(),
  sendVoiceDirect: vi.fn(),
  resolveMediaSource: vi.fn(),
  showTyping: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
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
}));

import { register } from "./send_file.js";

describe("send_file tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.showTyping.mockResolvedValue(undefined);
    mocks.resolveMediaSource.mockReturnValue({ source: "/path/to/file" });
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_file");
  });

  // ---- Photo ----

  it("auto-detects photo by extension and sends", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 10, caption: "hi" });
    const result = await call({ file: "/img/photo.jpg" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.type).toBe("photo");
    expect(mocks.sendPhoto).toHaveBeenCalledOnce();
  });

  it("auto-detects .png as photo", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 11 });
    await call({ file: "/img/shot.png" });
    expect(mocks.sendPhoto).toHaveBeenCalledOnce();
  });

  // ---- Document ----

  it("auto-detects unknown extension as document", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 12,
      document: { file_id: "doc1", file_name: "report.pdf" },
    });
    const result = await call({ file: "/docs/report.pdf" });
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
    const result = await call({ file: "/vids/clip.mp4" });
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
    const result = await call({ file: "/music/song.mp3" });
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
    const result = await call({ file: "/audio/note.ogg" });
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
    const result = await call({ file: "/img/image.jpg", type: "document" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.type).toBe("document");
    expect(mocks.sendPhoto).not.toHaveBeenCalled();
  });

  // ---- Caption ----

  it("passes caption to the send method", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 17, caption: "Look!" });
    await call({ file: "/img/photo.jpg", caption: "Look!" });
    expect(mocks.sendPhoto).toHaveBeenCalledWith(
      42,
      "/path/to/file",
      expect.objectContaining({ caption: expect.any(String) }),
    );
  });

  // ---- resolveMediaSource error ----

  it("returns error when resolveMediaSource fails", async () => {
    mocks.resolveMediaSource.mockReturnValue({ code: "INVALID_SOURCE", message: "bad" });
    const result = await call({ file: "http://insecure.com/file.txt" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("INVALID_SOURCE");
  });

  // ---- API error ----

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendPhoto.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request" }, "sendPhoto", {}),
    );
    const result = await call({ file: "/img/photo.jpg" });
    expect(isError(result)).toBe(true);
  });

  // ---- reply_to_message_id ----

  it("passes reply_parameters for reply_to_message_id", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 21 });
    await call({ file: "/img/pic.jpg", reply_to_message_id: 3 });
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
      type: "voice",
    });
    expect(isError(result)).toBe(true);
  });
});
