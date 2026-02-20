/**
 * Voice message transcription using @huggingface/transformers (Whisper via ONNX).
 *
 * Pure JS + ONNX Runtime + WASM audio decoding — zero external dependencies.
 * Model weights are downloaded once on first use and cached locally.
 *
 * WHISPER_MODEL env var selects the model (default: onnx-community/whisper-base).
 * WHISPER_CACHE_DIR env var overrides the model cache location.
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { readFile } from "fs/promises";
import { getApi, resolveChat } from "./telegram.js";

const MODEL = process.env.WHISPER_MODEL ?? "onnx-community/whisper-base";
const SAMPLE_RATE = 16000;

// Cache model in a predictable local directory, not inside node_modules.
if (process.env.WHISPER_CACHE_DIR) {
  env.cacheDir = process.env.WHISPER_CACHE_DIR;
}

// Singleton pipeline — model is loaded once and reused across calls.
let _pipelinePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = pipeline("automatic-speech-recognition", MODEL) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return _pipelinePromise;
}

/**
 * Decodes raw audio bytes (any format supported by audio-decode: OGG/Opus,
 * MP3, WAV, FLAC, etc.) into a mono Float32Array resampled to 16 kHz.
 */
async function decodeAudioToFloat32(audioBytes: Buffer): Promise<Float32Array> {
  // audio-decode is ESM-only, dynamic import required
  const { default: decode } = await import("audio-decode");
  const audioBuffer = await decode(audioBytes);

  // Take the first channel
  const channelData = audioBuffer.getChannelData(0);

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
 * No temp files are written — everything is processed in memory.
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

  // 3. Decode audio to Float32 PCM at 16 kHz (pure WASM, no ffmpeg)
  const audioData = await decodeAudioToFloat32(audioBytes);

  // 4. Transcribe — model is downloaded once and cached
  const transcriber = await getPipeline();
  const result = await transcriber(audioData) as { text: string };
  return result.text.trim();
}

/**
 * Reacts to the voice message with 📝, transcribes it, then swaps the
 * reaction to 🫡. Returns the transcribed text.
 * If reactions fail, transcription still proceeds.
 */
export async function transcribeWithIndicator(fileId: string, messageId?: number): Promise<string> {
  const chatId = resolveChat();

  // React with 📝 to signal transcription in progress (best-effort)
  if (typeof chatId === "string" && messageId !== undefined) {
    getApi().setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: "✍" }])
      .catch(() => {/* non-fatal */});
  }

  try {
    return await transcribeVoice(fileId);
  } finally {
    // Swap reaction to 🫡 when done (best-effort)
    if (typeof chatId === "string" && messageId !== undefined) {
      getApi().setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: "🫡" }])
        .catch(() => {/* non-fatal */});
    }
  }
}
