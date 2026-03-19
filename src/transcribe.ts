/**
 * Voice message transcription — external Whisper server or local ONNX fallback.
 *
 * STT_HOST (optional): base URL of an OpenAI-compatible ASR server, e.g.
 *   http://voice.cortex.lan  →  POST {STT_HOST}/v1/audio/transcriptions
 *   Audio bytes are forwarded as-is (multipart/form-data). No local decode.
 *
 * When STT_HOST is not set, falls back to the embedded ONNX pipeline:
 *   WHISPER_MODEL     — HuggingFace model ID (default: onnx-community/whisper-base)
 *   WHISPER_CACHE_DIR — override model cache directory
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { getApi, resolveChat, trySetMessageReaction, type ReactionEmoji } from "./telegram.js";

const RE_TRAILING_SLASHES = /\/+$/;

const REACT_TRANSCRIBING = "\u270D" as ReactionEmoji;  // ✍  Writing Hand
const REACT_DONE         = "\uD83E\uDEE1" as ReactionEmoji; // 🫡  Saluting Face

const LOCAL_MODEL = process.env.WHISPER_MODEL ?? "onnx-community/whisper-base";
const REMOTE_MODEL = process.env.WHISPER_MODEL ?? "whisper-1";
const SAMPLE_RATE = 16000;

// Cache model in a predictable local directory, not inside node_modules.
if (process.env.WHISPER_CACHE_DIR) {
  env.cacheDir = process.env.WHISPER_CACHE_DIR;
}

// Singleton pipeline — model is loaded once and reused across calls.
const ASR_TASK = "automatic-speech-recognition";
type ASRPipeline = AutomaticSpeechRecognitionPipeline;
let _pipelinePromise: Promise<ASRPipeline> | null = null;

function getPipeline(): Promise<ASRPipeline> {
  return _pipelinePromise ??= pipeline(ASR_TASK, LOCAL_MODEL);
}

/**
 * Sends raw audio bytes to an OpenAI-compatible transcription endpoint.
 * The server receives the bytes as a multipart file upload.
 */
async function transcribeRemote(audioBytes: Buffer, filename: string, host: string): Promise<string> {
  host = host.replace(RE_TRAILING_SLASHES, "");
  const url = `${host}/v1/audio/transcriptions`;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBytes)]), filename);
  form.append("model", REMOTE_MODEL);

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    process.stderr.write(`[stt] server error ${res.status}: ${body}\n`);
    throw new Error(`Whisper server returned ${res.status}. Check server logs for details.`);
  }
  const json = await res.json() as { text: string };
  return json.text.trim();
}

/**
 * Decodes raw audio bytes (any format supported by audio-decode: OGG/Opus,
 * MP3, WAV, FLAC, etc.) into a mono Float32Array resampled to 16 kHz.
 */
async function decodeAudioToFloat32(audioBytes: Buffer): Promise<Float32Array> {
  // audio-decode is ESM-only, dynamic import required
  interface DecodedAudio {
    channelData: Float32Array[];
    sampleRate: number;
  }
  const { default: decode } = await import("audio-decode") as { default: (buf: Buffer) => Promise<DecodedAudio> };
  const audioBuffer = await decode(audioBytes);

  // Take the first channel
  const channelData = audioBuffer.channelData[0]

  // Resample to 16 kHz if needed
  if (audioBuffer.sampleRate === SAMPLE_RATE) {
    return channelData;
  }

  const ratio = audioBuffer.sampleRate / SAMPLE_RATE;
  const newLength = Math.floor(channelData.length / ratio);
  const resampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    resampled[i] = channelData[Math.floor(i * ratio)];
  }
  return resampled;
}

/**
 * Downloads a Telegram voice message by file_id and transcribes it.
 * Returns the transcribed text (trimmed).
 *
 * If STT_HOST is set, audio bytes are forwarded to the remote server
 * (no local decode). Otherwise the embedded ONNX pipeline is used.
 */
export async function transcribeVoice(fileId: string): Promise<string> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN not set");

  // 1. Get the Telegram file path
  const fileInfo = await getApi().getFile(fileId);
  if (!fileInfo.file_path) throw new Error("Telegram returned no file_path");

  // 2. Download the audio bytes
  const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const audioBytes = Buffer.from(await res.arrayBuffer());

  // 3a. Remote transcription — forward raw bytes, no local decode.
  if (process.env.STT_HOST) {
    const filename = fileInfo.file_path.split("/").pop() ?? "audio.ogg";
    return transcribeRemote(audioBytes, filename, process.env.STT_HOST);
  }

  // 3b. Local ONNX fallback — decode audio to Float32 PCM at 16 kHz.
  const audioData = await decodeAudioToFloat32(audioBytes);

  // chunk_length_s + stride_length_s enable long-form transcription:
  // Whisper's context window is 30s, so audio longer than that is silently
  // truncated without chunking. stride_length_s overlaps adjacent chunks
  // to avoid losing words at chunk boundaries.
  const transcriber = await getPipeline();
  const result = await transcriber(audioData, {
    chunk_length_s: 30,
    stride_length_s: 5,
  }) as { text: string };
  return result.text.trim();
}

/**
 * Reacts to the voice message with ✍, transcribes it, then swaps the
 * reaction to 🫡. Returns the transcribed text.
 * If reactions fail, transcription still proceeds.
 */
export async function transcribeWithIndicator(fileId: string, messageId?: number): Promise<string> {
  const chatId = resolveChat();
  const reactId = typeof chatId === "number" ? chatId : undefined;

  if (reactId !== undefined && messageId !== undefined)
    void trySetMessageReaction(reactId, messageId, REACT_TRANSCRIBING);

  try {
    return await transcribeVoice(fileId);
  } finally {
    if (reactId !== undefined && messageId !== undefined)
      void trySetMessageReaction(reactId, messageId, REACT_DONE);
  }
}
