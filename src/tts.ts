/**
 * Text-to-speech synthesis module.
 *
 * Supported providers (TTS_PROVIDER env var):
 *
 *   local   — Free, zero configuration.  Uses @huggingface/transformers (ONNX)
 *             with opusscript (WASM libopus) for OGG/Opus encoding.
 *             Model is downloaded once on first use and cached locally.
 *             Env vars:
 *               TTS_MODEL_LOCAL  (default: Xenova/mms-tts-eng)
 *               TTS_CACHE_DIR    (optional cache directory override)
 *
 *   openai  — High quality.  Requires an OpenAI account and API key.
 *             Env vars:
 *               OPENAI_API_KEY (required)
 *               TTS_VOICE      (default: alloy — alloy/echo/fable/onyx/nova/shimmer)
 *               TTS_MODEL      (default: tts-1 — use tts-1-hd for higher quality)
 *
 *   ollama  — Uses a local Ollama instance (e.g. Kokoro) via its OpenAI-compatible
 *             /v1/audio/speech endpoint.  No API key required.
 *             Env vars:
 *               TTS_OLLAMA_HOST  (default: http://ollama.home.lan)
 *               TTS_MODEL        (default: kokoro)
 *               TTS_VOICE        (default: af_sky — Kokoro voices: af_sky, af_bella,
 *                                 af_nicole, af_sarah, am_adam, am_michael, …)
 *
 * Output:  OGG/Opus container — natively supported by Telegram sendVoice.
 *
 * Usage flow in send_message:
 *   1. stripForTts(originalText) → plain text (no markdown/HTML)
 *   2. synthesizeToOgg(plainText) → Buffer (OGG/Opus)
 *   3. new InputFile(buffer, "voice.ogg") → pass to grammy sendVoice
 */

import { pipeline, env } from "@huggingface/transformers";

/** Maximum characters accepted per TTS request (matches Telegram text limit). */
export const TTS_LIMIT = 4096;

/** Returns true when TTS delivery is globally configured via env vars.
 *  When TTS_PROVIDER is not set, defaults to the free local provider. */
export function isTtsEnabled(): boolean {
  const p = process.env.TTS_PROVIDER?.toLowerCase();
  return !p || p === "openai" || p === "local" || p === "ollama";
}

/**
 * Strips Markdown / MarkdownV2 / HTML formatting to plain text suitable for TTS synthesis.
 *
 * Rules applied in order:
 *   - Fenced code blocks: replaced with their content
 *   - Inline code: backticks removed, content kept
 *   - Bold, italic, underline, strikethrough markers removed
 *   - Links: display text kept, URL discarded
 *   - Headings (#, ##, …): prefix stripped
 *   - Blockquote markers (>) stripped
 *   - HTML tags (b, i, u, s, code, pre, a): unwrapped to content
 *   - MarkdownV2 escape sequences (\. \! etc.) unescaped
 */
export function stripForTts(text: string): string {
  return (
    text
      // Normalize MCP transport escape sequences before any other processing
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      // Fenced code blocks — keep inner content, strip fence lines
      .replace(/```[\w]*\n?([\s\S]*?)```/g, "$1")
      // Inline code — remove backtick delimiters
      .replace(/`([^`]+)`/g, "$1")
      // Bold (**text** and *text*)
      .replace(/\*\*(.+?)\*\*/gs, "$1")
      .replace(/\*(.+?)\*/gs, "$1")
      // Underline (__text__) before italic (_text_)
      .replace(/__(.+?)__/gs, "$1")
      // Italic / MarkdownV2 italic
      .replace(/_(.+?)_/gs, "$1")
      // Strikethrough (~~text~~ and MarkdownV2 ~text~)
      .replace(/~~(.+?)~~/gs, "$1")
      .replace(/~(.+?)~/gs, "$1")
      // Links — keep display text, discard URL
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Headings — strip leading # markers
      .replace(/^#{1,6}\s+/gm, "")
      // Blockquotes — strip leading > marker
      .replace(/^>\s*/gm, "")
      // HTML: inline tags — unwrap to content
      .replace(/<b[^>]*>(.*?)<\/b>/gis, "$1")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "$1")
      .replace(/<i[^>]*>(.*?)<\/i>/gis, "$1")
      .replace(/<em[^>]*>(.*?)<\/em>/gis, "$1")
      .replace(/<u[^>]*>(.*?)<\/u>/gis, "$1")
      .replace(/<ins[^>]*>(.*?)<\/ins>/gis, "$1")
      .replace(/<s[^>]*>(.*?)<\/s>/gis, "$1")
      .replace(/<del[^>]*>(.*?)<\/del>/gis, "$1")
      .replace(/<code[^>]*>(.*?)<\/code>/gis, "$1")
      .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "$1")
      .replace(/<a[^>]*>(.*?)<\/a>/gis, "$1")
      // Strip any remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // MarkdownV2 escaped special chars — unescape
      .replace(/\\([_*[\]()~`>#+=|{}.!-])/g, "$1")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Local provider (TTS_PROVIDER=local)
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_MODEL = "Xenova/mms-tts-eng";

// Singleton — model is loaded once and reused across calls.
let _localPipeline: Promise<(text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>> | null = null;

/** @internal Exposed for testing — resets the local pipeline singleton. */
export function _resetLocalPipeline(): void {
  _localPipeline = null;
}

function getLocalPipeline() {
  if (!_localPipeline) {
    const model = process.env.TTS_MODEL_LOCAL ?? DEFAULT_LOCAL_MODEL;
    if (process.env.TTS_CACHE_DIR) {
      env.cacheDir = process.env.TTS_CACHE_DIR;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _localPipeline = pipeline("text-to-speech", model) as any;
  }
  return _localPipeline!;
}

async function synthesizeLocalToOgg(text: string): Promise<Buffer> {
  const synthesizer = await getLocalPipeline();
  const result = await synthesizer(text);
  const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
  return pcmToOggOpus(result.audio, result.sampling_rate);
}

// ---------------------------------------------------------------------------
// OpenAI provider (TTS_PROVIDER=openai)
// ---------------------------------------------------------------------------

async function synthesizeOpenAiToOgg(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("TTS_PROVIDER=openai requires the OPENAI_API_KEY environment variable to be set.");
  }

  const voice = process.env.TTS_VOICE ?? "alloy";
  const model = process.env.TTS_MODEL ?? "tts-1";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: "wav", // Convert locally to guaranteed OGG/Opus container
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`OpenAI TTS API error ${res.status}: ${body}`);
  }

  const wav = Buffer.from(await res.arrayBuffer());
  const { default: decode } = await import("audio-decode");
  const decoded = await decode(wav);
  const channelData = decoded.getChannelData(0);
  const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
  return pcmToOggOpus(channelData, decoded.sampleRate);
}

// ---------------------------------------------------------------------------
// Ollama provider (TTS_PROVIDER=ollama)
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_HOST = "http://ollama.home.lan:8787";
const DEFAULT_OLLAMA_MODEL = "kokoro";
const DEFAULT_OLLAMA_VOICE = "af_sky";

async function synthesizeOllamaToOgg(text: string): Promise<Buffer> {
  const host = (process.env.TTS_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST).replace(/\/$/, "");
  const model = process.env.TTS_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const voice = process.env.TTS_VOICE ?? DEFAULT_OLLAMA_VOICE;

  const res = await fetch(`${host}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: "wav",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Ollama TTS error ${res.status}: ${body}`);
  }

  const wav = Buffer.from(await res.arrayBuffer());
  const { default: decode } = await import("audio-decode");
  const decoded = await decode(wav);
  const channelData = decoded.getChannelData(0);
  const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
  return pcmToOggOpus(channelData, decoded.sampleRate);
}

// ---------------------------------------------------------------------------
// Public synthesis entry point
// ---------------------------------------------------------------------------

/**
 * Validates common TTS input guards (empty / oversized text).
 * Called by both providers before synthesis.
 */
function validateTtsInput(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new Error("TTS input text must not be empty.");
  }
  if (text.length > TTS_LIMIT) {
    throw new Error(`TTS input too long (${text.length} chars, limit ${TTS_LIMIT}). Split the text first.`);
  }
}

/**
 * Synthesizes plain text to an OGG/Opus audio buffer.
 *
 * - Dispatches to the provider selected by `TTS_PROVIDER`.
 * - Input `text` should already be stripped of formatting (call `stripForTts` first).
 * - Input length must be ≤ `TTS_LIMIT` (4096) characters.
 * - Returns a raw Buffer containing the OGG/Opus audio — pass directly to grammy
 *   `sendVoice` via `new InputFile(buffer, "voice.ogg")`.
 *
 * @throws If no provider is configured, input is empty/oversized, or synthesis fails.
 */
export async function synthesizeToOgg(text: string): Promise<Buffer> {
  validateTtsInput(text);

  const provider = process.env.TTS_PROVIDER?.toLowerCase();

  if (provider === "openai") return synthesizeOpenAiToOgg(text);
  if (provider === "ollama") return synthesizeOllamaToOgg(text);
  // "local" or unset — default to the free local provider
  return synthesizeLocalToOgg(text);
}
