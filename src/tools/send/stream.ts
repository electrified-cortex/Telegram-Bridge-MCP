import { randomUUID } from "crypto";
import { getApi, toResult, toError, resolveChat, validateText } from "../../telegram.js";
import { getMessage, recordOutgoing, recordOutgoingEdit, CURRENT } from "../../message-store.js";
import { requireAuth } from "../../session-gate.js";
import { resolveParseMode } from "../../markdown.js";

interface StreamEntry {
  messageId: number;
  sid: number;
}

// Active stream state — stream_id → entry
const activeStreams = new Map<string, StreamEntry>();

const STREAM_PLACEHOLDER = "⏳ ...";

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
    const msg = await getApi().sendMessage(chatId, resolved.text, { parse_mode: resolved.parse_mode } as Record<string, unknown>);
    recordOutgoing(msg.message_id, "text", initialText);
    const streamId = randomUUID();
    activeStreams.set(streamId, { messageId: msg.message_id, sid: _sid });
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

  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const current = getMessage(entry.messageId, CURRENT);
  const currentText = (current?.content.type === "text" ? current.content.text : null) ?? "";

  // If current text is just the placeholder, replace it; otherwise append
  const accumulated = currentText === STREAM_PLACEHOLDER || currentText === ""
    ? text
    : `${currentText}${separator}${text}`;

  const resolved = resolveParseMode(accumulated, parse_mode);
  const textErr = validateText(resolved.text);
  if (textErr) return toError(textErr);

  try {
    const result = await getApi().editMessageText(chatId, entry.messageId, resolved.text, { parse_mode: resolved.parse_mode });
    const editedId = typeof result === "boolean" ? entry.messageId : result.message_id;
    recordOutgoingEdit(editedId, "text", accumulated);
    return toResult({ message_id: editedId, length: accumulated.length });
  } catch (err) {
    return toError(err);
  }
}

export async function handleStreamFlush({
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

  activeStreams.delete(stream_id);

  const current = getMessage(entry.messageId, CURRENT);
  const finalText = (current?.content.type === "text" ? current.content.text : null) ?? "";

  return toResult({ message_id: entry.messageId, final_length: finalText.length, status: "flushed" });
}

/** Exposed for testing only — clears all active streams. */
export function _resetStreamsForTest(): void {
  activeStreams.clear();
}
