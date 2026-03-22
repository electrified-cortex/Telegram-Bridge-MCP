import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import { isTtsEnabled, stripForTts, synthesizeToOgg, fetchVoiceList, TTS_LIMIT, _resetLocalPipeline } from "./tts.js";

// Mock @huggingface/transformers so no model is downloaded during tests
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {},
}));

// Mock the OGG encoder to avoid WASM loading in tests
vi.mock("./ogg-opus-encoder.js", () => ({
  pcmToOggOpus: vi.fn(),
}));

vi.mock("audio-decode", () => ({
  default: vi.fn(),
}));

type LocalSynthesizer = (text: string) => Promise<{
  audio: Float32Array;
  sampling_rate: number;
}>;

// ---------------------------------------------------------------------------
// isTtsEnabled
// ---------------------------------------------------------------------------

describe("isTtsEnabled", () => {
  it("always returns true — local provider is always available", () => {
    expect(isTtsEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stripForTts
// ---------------------------------------------------------------------------

describe("stripForTts", () => {
  it("returns plain text unchanged", () => {
    expect(stripForTts("Hello world")).toBe("Hello world");
  });

  it("removes **bold** markers", () => {
    expect(stripForTts("**hello**")).toBe("hello");
  });

  it("removes *bold* single-asterisk markers", () => {
    expect(stripForTts("*hi*")).toBe("hi");
  });

  it("removes _italic_ markers", () => {
    expect(stripForTts("_hello_")).toBe("hello");
  });

  it("removes __underline__ before _italic_", () => {
    expect(stripForTts("__under__")).toBe("under");
  });

  it("removes ~~strikethrough~~ markers", () => {
    expect(stripForTts("~~gone~~")).toBe("gone");
  });

  it("removes ~MarkdownV2 strikethrough~ markers", () => {
    expect(stripForTts("~gone~")).toBe("gone");
  });

  it("removes inline `code` backticks but keeps content", () => {
    expect(stripForTts("`console.log()`")).toBe("console.log()");
  });

  it("removes fenced code block fences but keeps code content", () => {
    expect(stripForTts("```js\nconsole.log('hi');\n```").trim()).toBe("console.log('hi');");
  });

  it("extracts link display text, discards URL", () => {
    expect(stripForTts("[click here](https://example.com)")).toBe("click here");
  });

  it("strips heading # prefixes", () => {
    expect(stripForTts("# Title")).toBe("Title");
    expect(stripForTts("## Subtitle")).toBe("Subtitle");
  });

  it("strips blockquote > markers", () => {
    expect(stripForTts("> quoted text")).toBe("quoted text");
  });

  it("unescapes MarkdownV2 escape sequences", () => {
    expect(stripForTts("Hello\\. World\\!")).toBe("Hello. World!");
  });

  it("strips HTML bold tags", () => {
    expect(stripForTts("<b>bold</b>")).toBe("bold");
  });

  it("strips HTML italic tags", () => {
    expect(stripForTts("<i>italic</i>")).toBe("italic");
  });

  it("strips HTML link tags keeping display text", () => {
    expect(stripForTts('<a href="https://x.com">link</a>')).toBe("link");
  });

  it("strips HTML code and pre tags", () => {
    expect(stripForTts("<code>val</code>")).toBe("val");
    expect(stripForTts("<pre>block</pre>")).toBe("block");
  });

  it("handles mixed formatting", () => {
    const input = "**Summary**: _done_ at [example.com](https://example.com)!";
    expect(stripForTts(input)).toBe("Summary: done at example.com!");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(stripForTts("   ")).toBe("");
  });

  it("normalizes literal \\n sequences to real newlines (MCP transport)", () => {
    // When text arrives over MCP with literal backslash-n, it should become a space/newline, not be spoken as "backslash n"
    expect(stripForTts("line one\\nline two")).toBe("line one\nline two");
  });

  it("normalizes backslash-escaped quotes (MCP transport)", () => {
    expect(stripForTts('use \\"claw\\" and \\"provisioner\\"')).toBe('use "claw" and "provisioner"');
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — shared input guards (provider-agnostic)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg input guards", () => {
  it("throws for empty text (before provider check)", async () => {
    await expect(synthesizeToOgg("")).rejects.toThrow("must not be empty");
  });

  it("throws for whitespace-only text", async () => {
    await expect(synthesizeToOgg("   ")).rejects.toThrow("must not be empty");
  });

  it(`throws when text exceeds TTS_LIMIT (${TTS_LIMIT} chars)`, async () => {
    await expect(synthesizeToOgg("a".repeat(TTS_LIMIT + 1))).rejects.toThrow("TTS input too long");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — OpenAI provider (no network calls)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (openai provider)", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("routes to OpenAI when OPENAI_API_KEY is set (no TTS_HOST)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TTS_VOICE = "nova";
    process.env.TTS_MODEL = "tts-1-hd";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.05, -0.05, 0.0]);
    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [fakePcm],
    });
    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");
    expect(result).toBe(fakeOgg);
    expect(pcmToOggOpus).toHaveBeenCalledWith(fakePcm, 24000);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello");
    expect(body.voice).toBe("nova");
    expect(body.model).toBe("tts-1-hd");
    expect(body.response_format).toBe("wav");

    delete process.env.TTS_VOICE;
    delete process.env.TTS_MODEL;
  });

  it("throws a descriptive error when API returns non-ok status", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("401");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — HTTP provider (TTS_HOST)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (TTS_HOST provider)", () => {
  afterEach(() => {
    delete process.env.TTS_HOST;
    delete process.env.TTS_VOICE;
    delete process.env.TTS_MODEL;
    delete process.env.TTS_FORMAT;
    vi.unstubAllGlobals();
  });

  it("calls TTS_HOST /v1/audio/speech with model and voice when set", async () => {
    process.env.TTS_HOST = "http://myserver.local:8080";
    process.env.TTS_MODEL = "chatterbox";
    process.env.TTS_VOICE = "default";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.1, -0.1, 0.0]);
    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [fakePcm],
    });
    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");
    expect(result).toBe(fakeOgg);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://myserver.local:8080/v1/audio/speech");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello");
    expect(body.model).toBe("chatterbox");
    expect(body.voice).toBe("default");
    expect(body.response_format).toBe("wav");
  });

  it("strips trailing slash from TTS_HOST", async () => {
    process.env.TTS_HOST = "http://myserver.local/";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [new Float32Array(1)],
    });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("test");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://myserver.local/v1/audio/speech");
  });

  it("omits model and voice from body when not set", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    // TTS_MODEL and TTS_VOICE not set

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("test");

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.model).toBeUndefined();
    expect(body.voice).toBeUndefined();
  });

  it("throws a descriptive error when TTS_HOST returns non-ok status", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("500");
  });

  it("returns buffer directly when TTS_FORMAT=opus (skips decode+re-encode)", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    process.env.TTS_FORMAT = "opus";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.clearAllMocks(); // reset call counts from prior tests

    // Use an isolated ArrayBuffer so Buffer.from(arrayBuffer) in the impl
    // produces exactly the same bytes (pooled buffers have extra padding).
    const bytes = Buffer.from("fake-native-ogg");
    const arrBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const fakeOgg = Buffer.from(arrBuf);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrBuf),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");

    // Buffer returned directly — decode and pcmToOggOpus must NOT be called
    expect(decode).not.toHaveBeenCalled();
    expect(pcmToOggOpus).not.toHaveBeenCalled();
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).response_format).toBe("opus");
    expect(result).toEqual(fakeOgg);
  });

  it("returns buffer directly when TTS_FORMAT=ogg", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    process.env.TTS_FORMAT = "ogg";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from("fake-ogg").buffer),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hello");

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).response_format).toBe("ogg");
  });

  it("works with Kokoro: base path in TTS_HOST, ogg format, voice, no model", async () => {
    // Mirrors a Kokoro config:
    //   TTS_HOST=http://your-kokoro-server/kokoro
    //   TTS_FORMAT=ogg
    //   TTS_VOICE=af_heart
    // Expected URL: POST http://your-kokoro-server/kokoro/v1/audio/speech
    // Expected body: { input, response_format: "ogg", voice: "af_heart" }  — no model field
    process.env.TTS_HOST = "http://your-kokoro-server/kokoro";
    process.env.TTS_FORMAT = "ogg";
    process.env.TTS_VOICE = "af_heart";

    const bytes = Buffer.from("fake-kokoro-ogg");
    const arrBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(arrBuf) });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello kokoro");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://your-kokoro-server/kokoro/v1/audio/speech");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello kokoro");
    expect(body.response_format).toBe("ogg");
    expect(body.voice).toBe("af_heart");
    expect(body.model).toBeUndefined();
    expect(opts.headers["Authorization"]).toBeUndefined();
    // OGG passthrough — result is the raw buffer from the server
    expect(result).toEqual(Buffer.from(arrBuf));
  });

  it("includes speed in the request body when speed is provided and not 1.0", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello", undefined, 1.5);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBe(1.5);
  });

  it("omits speed from the request body when speed is not provided", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello");

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBeUndefined();
  });

  it("omits speed from the request body when speed is exactly 1.0", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello", undefined, 1.0);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — local provider (mocked HF + OGG encoder)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (local provider)", () => {
  beforeEach(() => {
    _resetLocalPipeline();
  });

  afterEach(() => {
    delete process.env.TTS_MODEL_LOCAL;
    _resetLocalPipeline();
    vi.clearAllMocks();
  });

  it("calls HuggingFace pipeline and pcmToOggOpus, returns a Buffer", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.1, -0.1, 0.0]);
    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: fakePcm, sampling_rate: 16000 });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);

    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const result = await synthesizeToOgg("hello");

    expect(fakeSynthesizer).toHaveBeenCalledWith("hello");
    expect(pcmToOggOpus).toHaveBeenCalledWith(fakePcm, 16000);
    expect(result).toBe(fakeOgg);
  });

  it("passes TTS_MODEL_LOCAL to the pipeline constructor", async () => {
    process.env.TTS_MODEL_LOCAL = "custom/model";
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 22050,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("test");

    expect(pipeline).toHaveBeenCalledWith("text-to-speech", "custom/model");
  });

  it("reuses the pipeline singleton across calls", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 16000,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("first call");
    await synthesizeToOgg("second call");

    // pipeline() constructor must be called only once (singleton)
    expect(pipeline).toHaveBeenCalledTimes(1);
    // but the synthesizer itself is called once per synthesis
    expect(fakeSynthesizer).toHaveBeenCalledTimes(2);
  });

  it("uses local provider when neither TTS_HOST nor OPENAI_API_KEY is set", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 16000,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const result = await synthesizeToOgg("hello");
    expect(fakeSynthesizer).toHaveBeenCalledWith("hello");
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchVoiceList
// ---------------------------------------------------------------------------

describe("fetchVoiceList", () => {
  afterEach(() => {
    delete process.env.TTS_HOST;
    delete process.env.TTS_VOICES_URL;
    vi.unstubAllGlobals();
  });

  it("returns empty array when TTS_HOST is not set", async () => {
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch returns non-ok status", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("uses TTS_VOICES_URL override when set", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    process.env.TTS_VOICES_URL = "http://other-host/voices";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal("fetch", mockFetch);
    await fetchVoiceList();
    expect(mockFetch.mock.calls[0][0]).toBe("http://other-host/voices");
  });

  it("parses { voices: [{ voice_id, name, language, gender }] } (Kokoro-style)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        voices: [{ voice_id: "af_heart", name: "Heart", language: "en", gender: "female" }],
      }),
    }));
    const result = await fetchVoiceList();
    expect(result).toEqual([{ name: "af_heart", description: "Heart", language: "en", gender: "female" }]);
  });

  it("parses { voices: [{ name }] } (plain objects)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ voices: [{ name: "nova" }, { name: "echo" }] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["nova", "echo"]);
  });

  it("parses { voices: ['name', ...] } (string list)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ voices: ["alloy", "shimmer"] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["alloy", "shimmer"]);
  });

  it("parses bare array [{ id }] (OpenAI models-style via data key)", async () => {
    process.env.TTS_HOST = "http://openai.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "tts-1" }, { id: "tts-1-hd" }] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["tts-1", "tts-1-hd"]);
  });

  it("parses bare string array", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(["voice-a", "voice-b"]),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["voice-a", "voice-b"]);
  });

  it("returns empty array for unknown response shape", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unknown: "structure" }),
    }));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("strips trailing slash from TTS_HOST before building voices URL", async () => {
    process.env.TTS_HOST = "http://kokoro.local/";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal("fetch", mockFetch);
    await fetchVoiceList();
    expect(mockFetch.mock.calls[0][0]).toBe("http://kokoro.local/v1/audio/voices");
  });
});
