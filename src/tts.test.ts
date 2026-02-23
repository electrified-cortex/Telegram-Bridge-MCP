import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isTtsEnabled, stripForTts, synthesizeToOgg, TTS_LIMIT, _resetLocalPipeline } from "./tts.js";

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

// ---------------------------------------------------------------------------
// isTtsEnabled
// ---------------------------------------------------------------------------

describe("isTtsEnabled", () => {
  afterEach(() => {
    delete process.env.TTS_PROVIDER;
  });

  it("returns true when TTS_PROVIDER is not set (defaults to local)", () => {
    expect(isTtsEnabled()).toBe(true);
  });

  it("returns true when TTS_PROVIDER=openai", () => {
    process.env.TTS_PROVIDER = "openai";
    expect(isTtsEnabled()).toBe(true);
  });

  it("returns true when TTS_PROVIDER=local", () => {
    process.env.TTS_PROVIDER = "local";
    expect(isTtsEnabled()).toBe(true);
  });

  it("is case-insensitive (OpenAI, OPENAI, LOCAL, Local)", () => {
    process.env.TTS_PROVIDER = "OpenAI";
    expect(isTtsEnabled()).toBe(true);
    process.env.TTS_PROVIDER = "OPENAI";
    expect(isTtsEnabled()).toBe(true);
    process.env.TTS_PROVIDER = "LOCAL";
    expect(isTtsEnabled()).toBe(true);
    process.env.TTS_PROVIDER = "Local";
    expect(isTtsEnabled()).toBe(true);
  });

  it("returns false for unknown provider values", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    expect(isTtsEnabled()).toBe(false);
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
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — shared input guards (provider-agnostic)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg input guards", () => {
  afterEach(() => {
    delete process.env.TTS_PROVIDER;
  });

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
    delete process.env.TTS_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("throws when OPENAI_API_KEY is not set", async () => {
    process.env.TTS_PROVIDER = "openai";
    await expect(synthesizeToOgg("hello")).rejects.toThrow("OPENAI_API_KEY");
  });

  it("calls OpenAI API with correct parameters", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TTS_VOICE = "nova";
    process.env.TTS_MODEL = "tts-1-hd";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.05, -0.05, 0.0]);
    vi.mocked(decode as any).mockResolvedValue({
      sampleRate: 24000,
      getChannelData: () => fakePcm,
    });
    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
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
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("401");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — local provider (mocked HF + OGG encoder)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (local provider)", () => {
  beforeEach(() => {
    process.env.TTS_PROVIDER = "local";
    _resetLocalPipeline();
  });

  afterEach(() => {
    delete process.env.TTS_PROVIDER;
    delete process.env.TTS_MODEL_LOCAL;
    _resetLocalPipeline();
    vi.clearAllMocks();
  });

  it("calls HuggingFace pipeline and pcmToOggOpus, returns a Buffer", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.1, -0.1, 0.0]);
    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: fakePcm, sampling_rate: 16000 });
    vi.mocked(pipeline as any).mockResolvedValue(fakeSynthesizer);

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

    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: new Float32Array(1), sampling_rate: 22050 });
    vi.mocked(pipeline as any).mockResolvedValue(fakeSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("test");

    expect(pipeline).toHaveBeenCalledWith("text-to-speech", "custom/model");
  });

  it("reuses the pipeline singleton across calls", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: new Float32Array(1), sampling_rate: 16000 });
    vi.mocked(pipeline as any).mockResolvedValue(fakeSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("first call");
    await synthesizeToOgg("second call");

    // pipeline() constructor must be called only once (singleton)
    expect(pipeline).toHaveBeenCalledTimes(1);
    // but the synthesizer itself is called once per synthesis
    expect(fakeSynthesizer).toHaveBeenCalledTimes(2);
  });

  it("defaults to local provider when TTS_PROVIDER is not set", async () => {
    delete process.env.TTS_PROVIDER; // override beforeEach
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: new Float32Array(1), sampling_rate: 16000 });
    vi.mocked(pipeline as any).mockResolvedValue(fakeSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const result = await synthesizeToOgg("hello");
    expect(fakeSynthesizer).toHaveBeenCalledWith("hello");
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
