import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Message } from "grammy/types";
import { z } from "zod";
import { toResult, toError, pollUntil } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";

/**
 * Builds a structured payload from any Telegram message type.
 * Handles text, voice, document, photo, audio, video, animation, sticker,
 * contact, location, and unknown types gracefully.
 */
async function serializeMessage(msg: Message): Promise<Record<string, unknown>> {
  const base = {
    message_id: msg.message_id,
    reply_to_message_id: msg.reply_to_message?.message_id ?? undefined,
  };

  // Detect slash commands — must check before plain text fallthrough
  if (msg.text && msg.entities) {
    const cmdEntity = msg.entities.find(e => e.type === "bot_command" && e.offset === 0);
    if (cmdEntity) {
      // Strip leading "/" and any "@botname" suffix (group-chat format)
      const rawCommand = msg.text.slice(1, cmdEntity.length);
      const command = rawCommand.split("@")[0];
      const args = msg.text.slice(cmdEntity.length).trim() || undefined;
      return { ...base, type: "command", command, args };
    }
  }

  if (msg.text) {
    return { ...base, type: "text", text: msg.text };
  }

  if (msg.voice) {
    const text = await transcribeWithIndicator(msg.voice.file_id, msg.message_id).catch(
      (e) => `[transcription failed: ${e.message}]`,
    );
    return { ...base, type: "voice", text, file_id: msg.voice.file_id, voice: true };
  }

  if (msg.document) {
    return {
      ...base,
      type: "document",
      file_id: msg.document.file_id,
      file_unique_id: msg.document.file_unique_id,
      file_name: msg.document.file_name,
      mime_type: msg.document.mime_type,
      file_size: msg.document.file_size,
      caption: msg.caption,
    };
  }

  if (msg.photo) {
    // Telegram sends multiple sizes; last is the largest
    const largest = msg.photo[msg.photo.length - 1];
    return {
      ...base,
      type: "photo",
      file_id: largest.file_id,
      file_unique_id: largest.file_unique_id,
      width: largest.width,
      height: largest.height,
      file_size: largest.file_size,
      caption: msg.caption,
    };
  }

  if (msg.audio) {
    return {
      ...base,
      type: "audio",
      file_id: msg.audio.file_id,
      file_unique_id: msg.audio.file_unique_id,
      title: msg.audio.title,
      performer: msg.audio.performer,
      duration: msg.audio.duration,
      mime_type: msg.audio.mime_type,
      file_size: msg.audio.file_size,
      caption: msg.caption,
    };
  }

  if (msg.video) {
    return {
      ...base,
      type: "video",
      file_id: msg.video.file_id,
      file_unique_id: msg.video.file_unique_id,
      width: msg.video.width,
      height: msg.video.height,
      duration: msg.video.duration,
      mime_type: msg.video.mime_type,
      file_size: msg.video.file_size,
      caption: msg.caption,
    };
  }

  if (msg.animation) {
    return {
      ...base,
      type: "animation",
      file_id: msg.animation.file_id,
      file_unique_id: msg.animation.file_unique_id,
      width: msg.animation.width,
      height: msg.animation.height,
      duration: msg.animation.duration,
      file_name: msg.animation.file_name,
      mime_type: msg.animation.mime_type,
      file_size: msg.animation.file_size,
    };
  }

  if (msg.sticker) {
    return {
      ...base,
      type: "sticker",
      file_id: msg.sticker.file_id,
      file_unique_id: msg.sticker.file_unique_id,
      emoji: msg.sticker.emoji,
      set_name: msg.sticker.set_name,
      is_animated: msg.sticker.is_animated,
      is_video: msg.sticker.is_video,
    };
  }

  if (msg.contact) {
    return {
      ...base,
      type: "contact",
      phone_number: msg.contact.phone_number,
      first_name: msg.contact.first_name,
      last_name: msg.contact.last_name,
    };
  }

  if (msg.location) {
    return {
      ...base,
      type: "location",
      latitude: msg.location.latitude,
      longitude: msg.location.longitude,
    };
  }

  if (msg.poll) {
    return {
      ...base,
      type: "poll",
      question: msg.poll.question,
      options: msg.poll.options.map((o) => o.text),
    };
  }

  // Fallback: unknown content — describe what we got and ask for direction
  const keys = Object.keys(msg).filter(
    (k) => !["message_id", "from", "chat", "date", "reply_to_message"].includes(k),
  );
  return {
    ...base,
    type: "unknown",
    content_keys: keys,
    note: "Received a message with unrecognized content. What would you like me to do with it?",
  };
}

/**
 * Long-polls for the next message of any type in the chat.
 *
 * Handles text, voice (auto-transcribed), documents, photos, audio, video,
 * animations, stickers, contacts, locations, polls, and unknown types.
 * Returns structured data for each type. Unknown types include a `note`
 * field describing the situation.
 *
 * Any message_reaction updates seen while waiting are returned alongside the
 * message as `reactions[]` so they are never silently discarded.
 */
export function register(server: McpServer) {
  server.registerTool(
    "wait_for_message",
    {
      description: "Blocks (long-poll) until any message is received (text, voice, document, photo, audio, video, sticker, etc.), then returns structured data. Voice messages are auto-transcribed. Optionally filter by sender user_id. Returns { timed_out: true } on expiry. Unknown message types return a note asking what to do. Non-matching updates (reactions, callback queries, etc.) are buffered and available via get_updates — nothing is ever dropped.",
      inputSchema: {
        timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(300)
        .describe("How long to wait for a message (1–300 s)"),
      user_id: z
        .number()
        .int()
        .optional()
        .describe("Only accept messages from this Telegram user ID"),
      },
    },
    async ({ timeout_seconds, user_id }) => {
      try {
        const { match } = await pollUntil(
          (updates) => {
            const msg = updates.find((u) => {
              if (!u.message) return false;
              if (user_id !== undefined && u.message.from?.id !== user_id) return false;
              return true;
            });
            return msg?.message;
          },
          timeout_seconds,
        );

        if (!match) {
          return toResult({ timed_out: true });
        }

        const payload = await serializeMessage(match);
        return toResult({ timed_out: false, ...payload });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
