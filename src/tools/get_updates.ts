import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, resetOffset, filterAllowedUpdates, toResult, toError, DEFAULT_ALLOWED_UPDATES } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";
import { drainBuffer } from "../update-buffer.js";

export function register(server: McpServer) {
  server.tool(
    "get_updates",
    "Retrieves pending Telegram updates using the server's internal offset (polling pattern). Call repeatedly to consume the update queue. Advances the offset automatically so previously seen updates are never re-delivered.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Max number of updates to return (1–100)"),
      timeout_seconds: z
        .number()
        .int()
        .min(0)
        .max(55)
        .default(0)
        .describe(
          "Long-poll timeout in seconds. 0 = short poll (instant). Up to 55 for long polling."
        ),
      allowed_updates: z
        .array(z.string())
        .optional()
        .describe(
          "Filter by update types, e.g. [\"message\", \"callback_query\"]. Omit to receive all."
        ),
      reset_offset: z
        .boolean()
        .optional()
        .describe("If true, resets the stored offset to 0 before fetching"),
    },
    async ({ limit, timeout_seconds, allowed_updates, reset_offset }) => {
      try {
        if (reset_offset) resetOffset();

        // Drain any updates buffered by pollUntil (wait_for_message, etc.)
        // before hitting the Telegram API — nothing is ever lost.
        const buffered = drainBuffer();
        const filteredBuffered = filterAllowedUpdates(buffered);

        // Only fetch from Telegram if buffer didn't already satisfy the limit.
        let fresh: typeof buffered = [];
        if (filteredBuffered.length < limit) {
          const fetched = await getApi().getUpdates({
            offset: getOffset(),
            limit: limit - filteredBuffered.length,
            timeout: timeout_seconds,
            allowed_updates: (allowed_updates ?? DEFAULT_ALLOWED_UPDATES) as any,
          });
          advanceOffset(fetched);
          fresh = filterAllowedUpdates(fetched);
        }

        const allUpdates = [...filteredBuffered, ...fresh];
        const sanitized = await Promise.all(allUpdates.map(async (u) => {
          if (u.message) {
            const msg = u.message;
            const base = { message_id: msg.message_id, reply_to_message_id: msg.reply_to_message?.message_id };

            if (msg.voice) {
              const text = await transcribeWithIndicator(msg.voice.file_id, msg.message_id).catch((e: Error) => `[transcription failed: ${e.message}]`);
              return { type: "message", content_type: "voice", ...base, text, file_id: msg.voice.file_id, voice: true };
            }
            if (msg.text) return { type: "message", content_type: "text", ...base, text: msg.text };
            if (msg.document) return { type: "message", content_type: "document", ...base, file_id: msg.document.file_id, file_unique_id: msg.document.file_unique_id, file_name: msg.document.file_name, mime_type: msg.document.mime_type, file_size: msg.document.file_size, caption: msg.caption };
            if (msg.photo) {
              const largest = msg.photo[msg.photo.length - 1];
              return { type: "message", content_type: "photo", ...base, file_id: largest.file_id, file_unique_id: largest.file_unique_id, width: largest.width, height: largest.height, file_size: largest.file_size, caption: msg.caption };
            }
            if (msg.audio) return { type: "message", content_type: "audio", ...base, file_id: msg.audio.file_id, file_unique_id: msg.audio.file_unique_id, title: msg.audio.title, performer: msg.audio.performer, duration: msg.audio.duration, mime_type: msg.audio.mime_type, file_size: msg.audio.file_size, caption: msg.caption };
            if (msg.video) return { type: "message", content_type: "video", ...base, file_id: msg.video.file_id, file_unique_id: msg.video.file_unique_id, width: msg.video.width, height: msg.video.height, duration: msg.video.duration, mime_type: msg.video.mime_type, file_size: msg.video.file_size, caption: msg.caption };
            if (msg.animation) return { type: "message", content_type: "animation", ...base, file_id: msg.animation.file_id, file_unique_id: msg.animation.file_unique_id, file_name: msg.animation.file_name, duration: msg.animation.duration, mime_type: msg.animation.mime_type };
            if (msg.sticker) return { type: "message", content_type: "sticker", ...base, file_id: msg.sticker.file_id, file_unique_id: msg.sticker.file_unique_id, emoji: msg.sticker.emoji, set_name: msg.sticker.set_name };
            if (msg.contact) return { type: "message", content_type: "contact", ...base, phone_number: msg.contact.phone_number, first_name: msg.contact.first_name, last_name: msg.contact.last_name };
            if (msg.location) return { type: "message", content_type: "location", ...base, latitude: msg.location.latitude, longitude: msg.location.longitude };
            if (msg.poll) return { type: "message", content_type: "poll", ...base, question: msg.poll.question, options: msg.poll.options.map((o: any) => o.text) };
            // Unknown message content
            const keys = Object.keys(msg).filter((k) => !["message_id", "from", "chat", "date", "reply_to_message"].includes(k));
            return { type: "message", content_type: "unknown", ...base, content_keys: keys, note: "Received a message with unrecognized content. What would you like me to do with it?" };
          }
          if (u.callback_query) return { type: "callback_query", callback_query_id: u.callback_query.id, data: u.callback_query.data, message_id: u.callback_query.message?.message_id };
          if ((u as any).message_reaction) {
            const mr = (u as any).message_reaction;
            const newEmoji = (mr.new_reaction ?? []).filter((r: any) => r.type === "emoji").map((r: any) => r.emoji);
            const oldEmoji = (mr.old_reaction ?? []).filter((r: any) => r.type === "emoji").map((r: any) => r.emoji);
            const user = mr.user ? { id: mr.user.id, name: [mr.user.first_name, mr.user.last_name].filter(Boolean).join(" "), username: mr.user.username } : undefined;
            return { type: "message_reaction", message_id: mr.message_id, user, emoji_added: newEmoji, emoji_removed: oldEmoji };
          }
          return { type: "other" };
        }));
        return toResult(sanitized);
      } catch (err) {
        return toError(err);
      }
    }
  );
}
