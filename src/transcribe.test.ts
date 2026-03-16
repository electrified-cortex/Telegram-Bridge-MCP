import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  setMessageReaction: vi.fn(),
  trySetMessageReaction: vi.fn((_chatId: number, _messageId: number, _emoji: string) => Promise.resolve(true)),
  resolveChat: vi.fn(() => 123),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("./telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    trySetMessageReaction: mocks.trySetMessageReaction,
  };
});

// Mock @huggingface/transformers pipeline for local fallback path
const pipelineMock = vi.hoisted(() => vi.fn());
vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
  env: { cacheDir: undefined as unknown },
}));

import { transcribeVoice, transcribeWithIndicator } from "./transcribe.js";

const FAKE_TOKEN = "fake-bot-token";
const FAKE_FILE_PATH = "voice/file_123.oga";
const FAKE_AUDIO = Buffer.from("fakeaudio");

function mockFetch(responses: { url?: RegExp | string; ok: boolean; body?: object | string; arrayBuffer?: Buffer }[]) {
  let callIdx = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const resp = responses[callIdx++] ?? responses[responses.length - 1];
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : "(non-string)";
    if (resp.url instanceof RegExp && !resp.url.test(urlStr)) {
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    }
    const audio = resp.arrayBuffer ?? FAKE_AUDIO;
    return Promise.resolve({
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      statusText: resp.ok ? "OK" : "Internal Server Error",
      arrayBuffer: () => Promise.resolve(audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength,
      )),
      json: () => Promise.resolve(resp.body as object),
      text: () => Promise.resolve(
        typeof resp.body === "string" ? resp.body : "",
      ),
    } as Response);
  });
}

describe("transcribe.ts", () => {
  const origToken = process.env.BOT_TOKEN;
  const origSttHost = process.env.STT_HOST;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOT_TOKEN = FAKE_TOKEN;
    delete process.env.STT_HOST;
    delete process.env.WHISPER_MODEL;
    mocks.getFile.mockResolvedValue({ file_path: FAKE_FILE_PATH });
  });

  afterEach(() => {
    process.env.BOT_TOKEN = origToken;
    process.env.STT_HOST = origSttHost;
    vi.restoreAllMocks();
  });

  describe("transcribeVoice — STT_HOST path", () => {
    beforeEach(() => {
      process.env.STT_HOST = "http://your-whisper-server";
    });

    it("posts audio to {STT_HOST}/v1/audio/transcriptions and returns text", async () => {
      mockFetch([
        { ok: true, arrayBuffer: FAKE_AUDIO },                        // Telegram download
        { ok: true, body: { text: "  hello world  " } },              // STT server
      ]);

      const result = await transcribeVoice("file_id_123");
      expect(result).toBe("hello world");

      const [, call1] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(call1[0]).toBe("http://your-whisper-server/v1/audio/transcriptions");
      expect(call1[1].method).toBe("POST");
    });

    it("strips trailing slash from STT_HOST", async () => {
      process.env.STT_HOST = "http://your-whisper-server/";
      mockFetch([
        { ok: true, arrayBuffer: FAKE_AUDIO },
        { ok: true, body: { text: "trimmed" } },
      ]);
      await transcribeVoice("x");
      const [, call1] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(call1[0]).toBe("http://your-whisper-server/v1/audio/transcriptions");
    });

    it("sends whisper-1 as default model", async () => {
      mockFetch([
        { ok: true, arrayBuffer: FAKE_AUDIO },
        { ok: true, body: { text: "ok" } },
      ]);
      await transcribeVoice("x");
      const [, call1] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const form: FormData = call1[1].body;
      expect(form.get("model")).toBeTruthy();
    });

    it("throws if STT server returns non-ok", async () => {
      mockFetch([
        { ok: true, arrayBuffer: FAKE_AUDIO },
        { ok: false, body: "server error" },
      ]);
      await expect(transcribeVoice("x")).rejects.toThrow("Whisper server returned 500");
    });

    it("throws if Telegram download fails", async () => {
      mockFetch([{ ok: false }]);
      await expect(transcribeVoice("x")).rejects.toThrow("Download failed");
    });

    it("throws if BOT_TOKEN is missing", async () => {
      delete process.env.BOT_TOKEN;
      await expect(transcribeVoice("x")).rejects.toThrow("BOT_TOKEN not set");
    });

    it("throws if getFile returns no file_path", async () => {
      mocks.getFile.mockResolvedValue({});
      await expect(transcribeVoice("x")).rejects.toThrow("no file_path");
    });
  });

  describe("transcribeVoice — local ONNX fallback", () => {
    it("uses the pipeline when STT_HOST is not set", async () => {
      mockFetch([{ ok: true, arrayBuffer: FAKE_AUDIO }]);

      const transcriber = vi.fn().mockResolvedValue({ text: "  local result  " });
      pipelineMock.mockResolvedValue(transcriber);

      // audio-decode mock via dynamic import — patch globalThis for the module
      vi.doMock("audio-decode", () => ({
        default: vi.fn().mockResolvedValue({
          sampleRate: 16000,
          getChannelData: () => new Float32Array([0.1, 0.2]),
        }),
      }));

      const result = await transcribeVoice("file_local");
      expect(typeof result).toBe("string");
    });
  });

  describe("transcribeWithIndicator", () => {
    beforeEach(() => {
      process.env.STT_HOST = "http://your-whisper-server";
      mocks.trySetMessageReaction.mockResolvedValue(true);
      mockFetch([
        { ok: true, arrayBuffer: FAKE_AUDIO },
        { ok: true, body: { text: "transcribed" } },
      ]);
    });

    it("returns transcribed text", async () => {
      const result = await transcribeWithIndicator("fid", 42);
      expect(result).toBe("transcribed");
    });

    it("sets ✍ reaction before transcribing", async () => {
      await transcribeWithIndicator("fid", 99);
      expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(123, 99, "✍");
    });

    it("sets 🫡 reaction after transcribing", async () => {
      await transcribeWithIndicator("fid", 99);
      expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(123, 99, "🫡");
    });

    it("still transcribes if reactions return false", async () => {
      mocks.trySetMessageReaction.mockResolvedValue(false);
      const result = await transcribeWithIndicator("fid", 1);
      expect(result).toBe("transcribed");
    });

    it("skips reactions when messageId is not provided", async () => {
      await transcribeWithIndicator("fid");
      expect(mocks.trySetMessageReaction).not.toHaveBeenCalled();
    });
  });
});
