import { randomUUID } from "crypto";
import { GrammyError } from "grammy";
import { getApi, toResult, toError, resolveChat, validateText } from "../../telegram.js";
import { getMessage, recordOutgoing, recordOutgoingEdit, CURRENT } from "../../message-store.js";
import { requireAuth } from "../../session-gate.js";
import { resolveParseMode } from "../../markdown.js";

/** Maximum characters Telegram accepts in a single message. */
const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Creation-time timeout (stream expires 10 minutes after stream/start, regardless of activity).
 * Override with STREAM_TIMEOUT_MS env var (milliseconds).
 * Default: 10 minutes.
 */
const STREAM_TIMEOUT_MS = (() => {
  const raw = process.env.STREAM_TIMEOUT_MS;
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10 * 60 * 1000; // 10 minutes
})();

interface StreamEntry {
  messageId: number;
  sid: number;
  /** Epoch-ms when the stream was opened. Used for expiry checks. */
  createdAt: number;
}

// Active stream state — stream_id → entry
const activeStreams = new Map<string, StreamEntry>();

const STREAM_PLACEHOLDER = "⏳ ...";

/** Returns true if the stream has exceeded STREAM_TIMEOUT_MS since creation. */
function isExpired(entry: StreamEntry): boolean {
  return Date.now() - entry.createdAt > STREAM_TIMEOUT_MS;
}

export async function handleStreamStart({
  text,
  parse_mode = "Markdown",
  token,
}: {
  text?: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const initialText = text ?? STREAM_PLACEHOLDER;
  const resolved = resolveParseMode(initialText, parse_mode);
  const textErr = validateText(resolved.text);
  if (textErr) return toError(textErr);

  try {
    const msg = await getApi().sendMessage(chatId, resolved.text, { parse_mode: resolved.parse_mode });
    recordOutgoing(msg.message_id, "text", initialText);
    const streamId = randomUUID();
    activeStreams.set(streamId, { messageId: msg.message_id, sid: _sid, createdAt: Date.now() });
    return toResult({ message_id: msg.message_id, stream_id: streamId });
  } catch (err) {
    return toError(err);
  }
}

export async function handleStreamChunk({
  stream_id,
  text,
  separator = "",
  parse_mode = "Markdown",
  token,
}: {
  stream_id: string;
  text: string;
  separator?: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const entry = activeStreams.get(stream_id);
  if (!entry) return toError({ code: "STREAM_NOT_FOUND" as const, message: `No active stream found with stream_id: "${stream_id}". Did you call stream/start first?` });
  if (entry.sid !== _sid) return toError({ code: "STREAM_FORBIDDEN" as const, message: "Stream belongs to a different session." });

  // Expiry check — remove the dead entry and signal the caller
  if (isExpired(entry)) {
    activeStreams.delete(stream_id);
    return toError({ code: "STREAM_EXPIRED" as const, message: `Stream "${stream_id}" expired after ${STREAM_TIMEOUT_MS / 1000}s after creation. Call stream/start to open a new stream.` });
  }

  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const current = getMessage(entry.messageId, CURRENT);
  const currentText = (current?.content.type === "text" ? current.content.text : null) ?? "";

  // If current text is just the placeholder, replace it; otherwise append
  const accumulated = currentText === STREAM_PLACEHOLDER || currentText === ""
    ? text
    : `${currentText}${separator}${text}`;

  // Overflow guard — check before hitting the Telegram API
  if (accumulated.length > TELEGRAM_MESSAGE_LIMIT) {
    return toError({
      code: "STREAM_OVERFLOW" as const,
      message: `Accumulated stream text (${accumulated.length} chars) would exceed Telegram's ${TELEGRAM_MESSAGE_LIMIT}-character limit. Flush the current stream and start a new one.`,
      currentLength: accumulated.length,
      maxLength: TELEGRAM_MESSAGE_LIMIT,
    });
  }

  const resolved = resolveParseMode(accumulated, parse_mode);
  const textErr = validateText(resolved.text);
  if (textErr) return toError(textErr);

  try {
    const result = await getApi().editMessageText(chatId, entry.messageId, resolved.text, { parse_mode: resolved.parse_mode });
    const editedId = typeof result === "boolean" ? entry.messageId : result.message_id;
    recordOutgoingEdit(editedId, "text", accumulated);
    return toResult({ message_id: editedId, length: accumulated.length });
  } catch (err) {
    // Rate-limited by Telegram — surface a structured error instead of propagating
    if (err instanceof GrammyError && err.error_code === 429) {
      const retryAfterSecs = err.parameters.retry_after ?? 5;
      return toError({
        code: "RATE_LIMITED" as const,
        message: `Telegram rate limit hit. Retry after ${retryAfterSecs} seconds.`,
        retryAfterMs: retryAfterSecs * 1000,
      });
    }
    return toError(err);
  }
}

export function handleStreamFlush({
  stream_id,
  token,
}: {
  stream_id: string;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const entry = activeStreams.get(stream_id);
  if (!entry) return toError({ code: "STREAM_NOT_FOUND" as const, message: `No active stream found with stream_id: "${stream_id}". Already flushed?` });
  if (entry.sid !== _sid) return toError({ code: "STREAM_FORBIDDEN" as const, message: "Stream belongs to a different session." });

  // Expiry check — expired streams cannot be flushed
  if (isExpired(entry)) {
    activeStreams.delete(stream_id);
    return toError({ code: "STREAM_EXPIRED" as const, message: `Stream "${stream_id}" expired after ${STREAM_TIMEOUT_MS / 1000}s after creation. The partial message remains in Telegram as-is.` });
  }

  activeStreams.delete(stream_id);

  const current = getMessage(entry.messageId, CURRENT);
  const finalText = (current?.content.type === "text" ? current.content.text : null) ?? "";

  return toResult({ message_id: entry.messageId, final_length: finalText.length, status: "flushed" });
}

/** Exposed for testing only — clears all active streams. */
export function _resetStreamsForTest(): void {
  activeStreams.clear();
}

/** Exposed for testing only — returns the configured stream timeout in ms. */
export function _getStreamTimeoutMsForTest(): number {
  return STREAM_TIMEOUT_MS;
}
