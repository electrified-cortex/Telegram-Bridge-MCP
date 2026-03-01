/**
 * Text-to-speech synthesis module.
 *
 * Provider is selected automatically from environment variables:
 *
 *   TTS_HOST set       — Any OpenAI-compatible /v1/audio/speech server.
 *                        No API key required unless the server demands one.
 *                        Env vars:
 *                          TTS_HOST    (required — e.g. http://your-tts-host)
 *                          TTS_MODEL   (optional — sent only if set)
 *                          TTS_VOICE   (optional — sent only if set)
 *                          TTS_FORMAT  (default: wav — set to opus or ogg if the
 *                                       server can return OGG/Opus directly;
 *                                       skips local decode+re-encode entirely)
 *
 *   OPENAI_API_KEY set — api.openai.com /v1/audio/speech.
 *   (no TTS_HOST)        Env vars:
 *                          OPENAI_API_KEY (required)
 *                          TTS_VOICE      (default: alloy)
 *                          TTS_MODEL      (default: tts-1)
 *
 *   Neither set        — Free local provider. Uses @huggingface/transformers (ONNX).
 *                        Model is downloaded once on first use and cached locally.
 *                        Env vars:
 *                          TTS_MODEL_LOCAL  (default: Xenova/mms-tts-eng)
 *                          TTS_CACHE_DIR    (optional cache directory override)
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

/** Always true — local provider is always available as a fallback. */
export function isTtsEnabled(): boolean {
  return true;
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
// Local provider (no TTS_HOST, no OPENAI_API_KEY)
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
// HTTP provider is above (TTS_HOST or OPENAI_API_KEY)
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// HTTP provider (TTS_HOST or OPENAI_API_KEY)
// ---------------------------------------------------------------------------

async function synthesizeHttpToOgg(text: string, host: string, apiKey: string | null): Promise<Buffer> {
  const model = process.env.TTS_MODEL;
  const voice = process.env.TTS_VOICE;
  const fmt = (process.env.TTS_FORMAT ?? "wav").toLowerCase();
  const nativeOgg = fmt === "opus" || fmt === "ogg";

  // Apply OpenAI defaults only when using the OpenAI endpoint
  const isOpenAi = host.includes("api.openai.com");
  const resolvedModel = model ?? (isOpenAi ? "tts-1" : undefined);
  const resolvedVoice = voice ?? (isOpenAi ? "alloy" : undefined);

  const body: Record<string, string> = { input: text, response_format: nativeOgg ? fmt : "wav" };
  if (resolvedModel) body.model = resolvedModel;
  if (resolvedVoice) body.voice = resolvedVoice;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${host}/v1/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`TTS API error ${res.status}: ${body}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());

  // If the server returns OGG/Opus natively, use it directly — no decode needed.
  if (nativeOgg) return audio;

  // Otherwise decode WAV → Float32 PCM → OGG/Opus
  const { default: decode } = await import("audio-decode");
  const decoded = await decode(audio);
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
 * - Dispatches to the right provider based on TTS_HOST / OPENAI_API_KEY env vars.
 * - Input `text` should already be stripped of formatting (call `stripForTts` first).
 * - Input length must be ≤ `TTS_LIMIT` (4096) characters.
 * - Returns a raw Buffer containing the OGG/Opus audio — pass directly to grammy
 *   `sendVoice` via `new InputFile(buffer, "voice.ogg")`.
 *
 * @throws If no provider is configured, input is empty/oversized, or synthesis fails.
 */
export async function synthesizeToOgg(text: string): Promise<Buffer> {
  validateTtsInput(text);

  const ttsHost = process.env.TTS_HOST?.replace(/\/$/, "");
  if (ttsHost) return synthesizeHttpToOgg(text, ttsHost, process.env.OPENAI_API_KEY ?? null);

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return synthesizeHttpToOgg(text, "https://api.openai.com", apiKey);

  return synthesizeLocalToOgg(text);
}
