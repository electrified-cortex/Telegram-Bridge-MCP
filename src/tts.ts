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
import type { VoiceEntry } from "./config.js";

// ---------------------------------------------------------------------------
// Regex constants for stripForTts — extracted to module level for reuse
// ---------------------------------------------------------------------------
const RE_ESCAPE_NEWLINE   = /\\n/g;
const RE_ESCAPE_QUOTE     = /\\"/g;
const RE_ESCAPE_BACKSLASH = /\\\\/g;
const RE_FENCED_CODE      = /```[\w]*\n?([\s\S]*?)```/g;
const RE_INLINE_CODE      = /`([^`]+)`/g;
const RE_BOLD_DOUBLE      = /\*\*(.+?)\*\*/gs;
const RE_BOLD_SINGLE      = /\*(.+?)\*/gs;
const RE_UNDERLINE        = /__(.+?)__/gs;
const RE_ITALIC           = /_(.+?)_/gs;
const RE_STRIKE_DOUBLE    = /~~(.+?)~~/gs;
const RE_STRIKE_SINGLE    = /~(.+?)~/gs;
const RE_LINK             = /\[([^\]]+)\]\([^)]+\)/g;
const RE_HEADING          = /^#{1,6}\s+/gm;
const RE_BLOCKQUOTE       = /^>\s*/gm;
const RE_HTML_B           = /<b[^>]*>(.*?)<\/b>/gis;
const RE_HTML_STRONG      = /<strong[^>]*>(.*?)<\/strong>/gis;
const RE_HTML_I           = /<i[^>]*>(.*?)<\/i>/gis;
const RE_HTML_EM          = /<em[^>]*>(.*?)<\/em>/gis;
const RE_HTML_U           = /<u[^>]*>(.*?)<\/u>/gis;
const RE_HTML_INS         = /<ins[^>]*>(.*?)<\/ins>/gis;
const RE_HTML_S           = /<s[^>]*>(.*?)<\/s>/gis;
const RE_HTML_DEL         = /<del[^>]*>(.*?)<\/del>/gis;
const RE_HTML_CODE        = /<code[^>]*>(.*?)<\/code>/gis;
const RE_HTML_PRE         = /<pre[^>]*>(.*?)<\/pre>/gis;
const RE_HTML_A           = /<a[^>]*>(.*?)<\/a>/gis;
const RE_HTML_ANY         = /<[^>]+>/g;
const RE_MV2_UNESCAPE     = /\\([_*[\]()~`>#+=|{}.!-])/g;
const RE_TRAILING_SLASH   = /\/+$/;
// Matches ALL-CAPS identifiers with underscores (e.g. SESSION_JOINED, MD_FAIL)
// Requires: starts with uppercase letter, contains at least one underscore, all chars uppercase/digit/underscore
const RE_ALL_CAPS_UNDERSCORE = /\b[A-Z][A-Z0-9]*_[A-Z0-9][A-Z0-9_]*\b/g;

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
 *   - ALL-CAPS-with-underscores identifiers normalized via normalizeCapsForTts
 *     (after backtick spans are stripped, before italic regex fires on underscores)
 */
export function stripForTts(text: string): string {
  // Step 1: MCP transport escapes + backtick code stripping
  // (backtick spans stripped before normalization; html code/pre stripped later in step 3)
  const afterCodeStrip = text
    .replace(RE_ESCAPE_NEWLINE, "\n")
    .replace(RE_ESCAPE_QUOTE, '"')
    .replace(RE_ESCAPE_BACKSLASH, "\\")
    .replace(RE_FENCED_CODE, "$1")
    .replace(RE_INLINE_CODE, "$1");
  // Step 2: normalize ALL-CAPS identifiers before _italic_ regex fires on underscores
  const normalized = normalizeCapsForTts(afterCodeStrip);
  // Step 3: remaining Markdown / HTML stripping
  return normalized
    .replace(RE_BOLD_DOUBLE, "$1")
    .replace(RE_BOLD_SINGLE, "$1")
    .replace(RE_UNDERLINE, "$1")
    .replace(RE_ITALIC, "$1")
    .replace(RE_STRIKE_DOUBLE, "$1")
    .replace(RE_STRIKE_SINGLE, "$1")
    .replace(RE_LINK, "$1")
    .replace(RE_HEADING, "")
    .replace(RE_BLOCKQUOTE, "")
    .replace(RE_HTML_B, "$1")
    .replace(RE_HTML_STRONG, "$1")
    .replace(RE_HTML_I, "$1")
    .replace(RE_HTML_EM, "$1")
    .replace(RE_HTML_U, "$1")
    .replace(RE_HTML_INS, "$1")
    .replace(RE_HTML_S, "$1")
    .replace(RE_HTML_DEL, "$1")
    .replace(RE_HTML_CODE, "$1")
    .replace(RE_HTML_PRE, "$1")
    .replace(RE_HTML_A, "$1")
    .replace(RE_HTML_ANY, "")
    .replace(RE_MV2_UNESCAPE, "$1")
    .trim();
}

/**
 * Normalizes ALL-CAPS-with-underscores identifiers in TTS audio text for better pronunciation.
 * Tokens are wrapped in double-quotes and lowercased: SESSION_JOINED → `"session joined"`.
 * The double-quote characters ARE spoken by the TTS engine (e.g. "quote session joined quote").
 *
 * Applies only to ALL-CAPS tokens (uppercase letters, digits, underscores) with at least one
 * underscore. Lower-case and mixed-case identifiers are left alone.
 *
 * Note: POSIX-style env var names (e.g. TTS_HOST, OPENAI_API_KEY) match this pattern and will
 * be normalized if they appear verbatim in TTS audio text. This is an accepted trade-off.
 *
 * Controlled by env var TTS_CAPS_NORMALIZE: set to "0", "false", "no", or "off" to disable (case-insensitive).
 */
export function normalizeCapsForTts(text: string): string {
  const capsNorm = process.env.TTS_CAPS_NORMALIZE;
  if (capsNorm !== undefined && ["0", "false", "no", "off"].includes(capsNorm.toLowerCase())) {
    return text;
  }
  return text.replace(RE_ALL_CAPS_UNDERSCORE, (match) =>
    `"${match.replace(/_/g, " ").toLowerCase()}"`
  );
}

// ---------------------------------------------------------------------------
// Local provider (no TTS_HOST, no OPENAI_API_KEY)
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_MODEL = "Xenova/mms-tts-eng";

// Singleton — model is loaded once and reused across calls.
type TTSSynthesizer = (text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>;

let _localPipeline: Promise<TTSSynthesizer> | null = null;

/** @internal Exposed for testing — resets the local pipeline singleton. */
export function _resetLocalPipeline(): void {
  _localPipeline = null;
}

function getLocalPipeline(): Promise<TTSSynthesizer> {
  if (_localPipeline) return _localPipeline;
  const model = process.env.TTS_MODEL_LOCAL ?? DEFAULT_LOCAL_MODEL;
  if (process.env.TTS_CACHE_DIR) {
    env.cacheDir = process.env.TTS_CACHE_DIR;
  }
  return (_localPipeline = pipeline("text-to-speech", model) as unknown as Promise<TTSSynthesizer>);
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

/**
 * Compute TTS synthesis timeout in milliseconds.
 * Scale by word count: max(60s, ceil(words/100) * 60s).
 * Floor of 60 seconds for all inputs.
 * Configurable via TTS_SYNTHESIS_TIMEOUT_PER_100_WORDS_MS (default 45000).
 * Configurable via TTS_SYNTHESIS_TIMEOUT_MIN_MS (default 45000).
 */
function wordCountForTimeout(text: string): number {
  return text.trim().split(/\s+/).length;
}

function computeTtsSynthesisTimeoutMs(text: string): number {
  const perHundredWords = (Math.max(0, parseInt(process.env.TTS_SYNTHESIS_TIMEOUT_PER_100_WORDS_MS ?? "", 10)) || 45000);
  const minMs = (Math.max(0, parseInt(process.env.TTS_SYNTHESIS_TIMEOUT_MIN_MS ?? "", 10)) || 45000);
  const wordCount = wordCountForTimeout(text);
  return Math.max(minMs, Math.ceil(wordCount / 100) * perHundredWords);
}

async function synthesizeHttpToOgg(
  text: string,
  host: string,
  apiKey: string | null,
  voice?: string,
  speed?: number,
): Promise<Buffer> {
  const model = process.env.TTS_MODEL;
  const envVoice = process.env.TTS_VOICE;
  const fmt = (process.env.TTS_FORMAT ?? "wav").toLowerCase();
  const nativeOgg = fmt === "opus" || fmt === "ogg";

  // Apply OpenAI defaults only when using the OpenAI endpoint
  const isOpenAi = host.includes("api.openai.com");
  const resolvedModel = model ?? (isOpenAi ? "tts-1" : undefined);
  const resolvedVoice =
    voice ?? envVoice ?? (isOpenAi ? "alloy" : undefined);

  const body: Record<string, string | number> = { input: text, response_format: nativeOgg ? fmt : "wav" };
  if (resolvedModel) body.model = resolvedModel;
  if (resolvedVoice) body.voice = resolvedVoice;
  if (speed !== undefined && speed !== 1.0) body.speed = speed;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const timeoutMs = computeTtsSynthesisTimeoutMs(text);
  let res: Response;
  try {
    res = await fetch(`${host}/v1/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      const wordCount = wordCountForTimeout(text);
      throw Object.assign(
        new Error(`tts_timeout: TTS synthesis timed out after ${timeoutMs}ms (~${wordCount} words). Local model not responding.`),
        { code: "tts_timeout", timeoutMs, wordCount }
      );
    }
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "(no body)");
    process.stderr.write(`[tts] server error ${res.status}: ${errorBody}\n`);
    if (res.status === 504) {
      throw new Error("TTS timed out (504). Consider shortening audio or retrying.");
    }
    throw new Error(`TTS server returned ${res.status}. Check server logs for details.`);
  }

  const audio = Buffer.from(await res.arrayBuffer());

  // If the server returns OGG/Opus natively, use it directly — no decode needed.
  if (nativeOgg) return audio;

  // Otherwise decode WAV → Float32 PCM → OGG/Opus
  interface DecodedAudio {
    channelData: Float32Array[];
    sampleRate: number;
  }
  const { default: decode } = await import("audio-decode") as { default: (buf: Buffer) => Promise<DecodedAudio> };
  const decoded = await decode(audio);
  const channelData = decoded.channelData[0];
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
export async function synthesizeToOgg(
  text: string,
  voice?: string,
  speed?: number,
): Promise<Buffer> {
  validateTtsInput(text);

  const ttsHost = process.env.TTS_HOST?.replace(RE_TRAILING_SLASH, "");
  if (ttsHost) return synthesizeHttpToOgg(text, ttsHost, process.env.OPENAI_API_KEY ?? null, voice, speed);

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return synthesizeHttpToOgg(text, "https://api.openai.com", apiKey, voice, speed);

  return synthesizeLocalToOgg(text);
}

// ---------------------------------------------------------------------------
// Voice listing
// ---------------------------------------------------------------------------

/**
 * Attempts to fetch available voices from the TTS server.
 *
 * Tries `GET {TTS_HOST}/v1/audio/voices` first (common for
 * Kokoro and similar OpenAI-compatible servers). Falls back to
 * `TTS_VOICES_URL` env var if the default endpoint fails.
 *
 * Returns an array of VoiceEntry objects, or an empty array
 * if no listing is available.
 */
export async function fetchVoiceList(): Promise<VoiceEntry[]> {
  const ttsHost = process.env.TTS_HOST?.replace(RE_TRAILING_SLASH, "");
  if (!ttsHost) return [];

  const voicesUrl =
    process.env.TTS_VOICES_URL ?? `${ttsHost}/v1/audio/voices`;

  try {
    const res = await fetch(voicesUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];

    const body: unknown = await res.json();
    return parseVoiceListResponse(body);
  } catch {
    return [];
  }
}

/**
 * Extracts voices from various API response shapes.
 *
 * Handles:
 *   - `{ voices: [{ voice_id, name, language, gender }] }` (Kokoro-style)
 *   - `{ voices: [{ name: "..." }, ...] }` (common OpenAI-compatible)
 *   - `{ voices: ["name", ...] }` (simple list)
 *   - `["name", ...]` (bare array)
 *   - `{ data: [{ id: "..." }, ...] }` (OpenAI models-style)
 */
function parseVoiceListResponse(body: unknown): VoiceEntry[] {
  if (Array.isArray(body)) {
    return body
      .filter((v): v is string => typeof v === "string")
      .map(name => ({ name }));
  }
  if (typeof body !== "object" || body === null) return [];

  const obj = body as Record<string, unknown>;

  if (Array.isArray(obj.voices)) {
    return obj.voices
      .map((v: unknown) => voiceObjectToEntry(v))
      .filter((v): v is VoiceEntry => v !== null);
  }

  if (Array.isArray(obj.data)) {
    return obj.data
      .map((v: unknown) => voiceObjectToEntry(v))
      .filter((v): v is VoiceEntry => v !== null);
  }

  return [];
}

/** Convert a single voice item (string or object) to a VoiceEntry. */
function voiceObjectToEntry(v: unknown): VoiceEntry | null {
  if (typeof v === "string") return { name: v };
  if (typeof v !== "object" || v === null) return null;

  const o = v as Record<string, unknown>;
  // Prefer voice_id (Kokoro), then id (OpenAI), then name
  const id =
    (typeof o.voice_id === "string" ? o.voice_id : null) ??
    (typeof o.id === "string" ? o.id : null) ??
    (typeof o.name === "string" ? o.name : null);
  if (!id) return null;

  const entry: VoiceEntry = { name: id };
  // Capture display name (only if different from the id)
  const displayName =
    typeof o.name === "string" ? o.name : undefined;
  if (displayName && displayName !== id) {
    entry.description = displayName;
  }
  if (typeof o.language === "string") entry.language = o.language;
  if (typeof o.gender === "string") entry.gender = o.gender;
  return entry;
}
