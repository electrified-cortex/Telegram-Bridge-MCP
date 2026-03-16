/**
 * Converts raw Telegram Update objects into structured, agent-readable objects.
 * Shared by get_update, get_updates, and session recording tools.
 */

import type { Update, ReactionTypeEmoji } from "grammy/types";
import type { SessionEntry } from "./session-recording.js";
import { transcribeWithIndicator } from "./transcribe.js";

export async function sanitizeUpdate(u: Update): Promise<Record<string, unknown>> {
  if (u.message) {
    const msg = u.message;
    const base = {
      message_id: msg.message_id,
      reply_to_message_id: msg.reply_to_message?.message_id,
    };

    if (msg.voice) {
      const text = await transcribeWithIndicator(msg.voice.file_id, msg.message_id)
        .catch((e: unknown) => `[transcription failed: ${e instanceof Error ? e.message : String(e)}]`);
      return {
        type: "message", content_type: "voice", ...base,
        text, file_id: msg.voice.file_id, voice: true,
      };
    }
    if (msg.text)
      return { type: "message", content_type: "text", ...base, text: msg.text };
    if (msg.document)
      return {
        type: "message", content_type: "document", ...base,
        file_id: msg.document.file_id,
        file_unique_id: msg.document.file_unique_id,
        file_name: msg.document.file_name,
        mime_type: msg.document.mime_type,
        file_size: msg.document.file_size,
        caption: msg.caption,
      };
    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      return {
        type: "message", content_type: "photo", ...base,
        file_id: largest.file_id,
        file_unique_id: largest.file_unique_id,
        width: largest.width,
        height: largest.height,
        file_size: largest.file_size,
        caption: msg.caption,
      };
    }
    if (msg.audio)
      return {
        type: "message", content_type: "audio", ...base,
        file_id: msg.audio.file_id,
        file_unique_id: msg.audio.file_unique_id,
        title: msg.audio.title,
        performer: msg.audio.performer,
        duration: msg.audio.duration,
        mime_type: msg.audio.mime_type,
        file_size: msg.audio.file_size,
        caption: msg.caption,
      };
    if (msg.video)
      return {
        type: "message", content_type: "video", ...base,
        file_id: msg.video.file_id,
        file_unique_id: msg.video.file_unique_id,
        width: msg.video.width,
        height: msg.video.height,
        duration: msg.video.duration,
        mime_type: msg.video.mime_type,
        file_size: msg.video.file_size,
        caption: msg.caption,
      };
    if (msg.animation)
      return {
        type: "message", content_type: "animation", ...base,
        file_id: msg.animation.file_id,
        file_unique_id: msg.animation.file_unique_id,
        file_name: msg.animation.file_name,
        duration: msg.animation.duration,
        mime_type: msg.animation.mime_type,
      };
    if (msg.sticker)
      return {
        type: "message", content_type: "sticker", ...base,
        file_id: msg.sticker.file_id,
        file_unique_id: msg.sticker.file_unique_id,
        emoji: msg.sticker.emoji,
        set_name: msg.sticker.set_name,
      };
    if (msg.contact)
      return {
        type: "message", content_type: "contact", ...base,
        phone_number: msg.contact.phone_number,
        first_name: msg.contact.first_name,
        last_name: msg.contact.last_name,
      };
    if (msg.location)
      return {
        type: "message", content_type: "location", ...base,
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
      };
    if (msg.poll)
      return {
        type: "message", content_type: "poll", ...base,
        question: msg.poll.question,
        options: msg.poll.options.map(o => o.text),
      };

    // Unknown message content
    const keys = Object.keys(msg).filter(
      (k) => !["message_id", "from", "chat", "date", "reply_to_message"].includes(k)
    );
    return { type: "message", content_type: "unknown", ...base, content_keys: keys, note: "Received a message with unrecognized content. What would you like me to do with it?" };
  }

  if (u.callback_query)
    return {
      type: "callback_query",
      callback_query_id: u.callback_query.id,
      data: u.callback_query.data,
      message_id: u.callback_query.message?.message_id,
    };

  if (u.message_reaction) {
    const mr = u.message_reaction;
    const newEmoji = mr.new_reaction.filter((r): r is ReactionTypeEmoji => r.type === "emoji").map(r => r.emoji);
    const oldEmoji = mr.old_reaction.filter((r): r is ReactionTypeEmoji => r.type === "emoji").map(r => r.emoji);
    // Expose only the user's numeric ID — name and username are PII the user
    // has not explicitly shared and must not be revealed without consent.
    const user = mr.user ? { id: mr.user.id } : undefined;
    return {
      type: "message_reaction",
      message_id: mr.message_id,
      user,
      emoji_added: newEmoji,
      emoji_removed: oldEmoji,
    };
  }

  return { type: "other" };
}

export async function sanitizeUpdates(updates: Update[]): Promise<Record<string, unknown>[]> {
  return Promise.all(updates.map(sanitizeUpdate));
}

/** Sanitizes a single SessionEntry (user or bot) into a displayable record. */
export async function sanitizeSessionEntry(entry: SessionEntry): Promise<Record<string, unknown>> {
  if (entry.direction === "user") {
    const sanitized = await sanitizeUpdate(entry.update);
    return { from: "user", ...sanitized };
  }
  const { direction: _direction, ...rest } = entry;
  return { from: "bot", ...rest };
}

export async function sanitizeSessionEntries(entries: SessionEntry[]): Promise<Record<string, unknown>[]> {
  return Promise.all(entries.map(sanitizeSessionEntry));
}
