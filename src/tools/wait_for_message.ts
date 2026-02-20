import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, pollUntil } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";

/**
 * Long-polls for the next text or voice message in a chat.
 *
 * Voice messages are automatically transcribed via local Whisper and returned
 * as plain text — transparent to the caller.
 *
 * Any message_reaction updates seen while waiting are returned alongside the
 * message as `reactions[]` so they are never silently discarded.
 */
export function register(server: McpServer) {
  server.tool(
    "wait_for_message",
    "Blocks (long-poll) until a text or voice message is received, then returns it. Voice messages are auto-transcribed. Optionally filter by sender user_id. Returns { timed_out: true } on expiry. Any message_reaction updates seen while waiting are included in the result as reactions[].",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("How long to wait for a message (1–55 s)"),
      user_id: z
        .number()
        .int()
        .optional()
        .describe("Only accept messages from this Telegram user ID"),
    },
    async ({ timeout_seconds, user_id }) => {
      try {
        const { match, missed } = await pollUntil(
          (updates) => {
            const msg = updates.find((u) => {
              if (!u.message?.text && !u.message?.voice) return false;
              if (user_id !== undefined && u.message.from?.id !== user_id) return false;
              return true;
            });
            return msg?.message;
          },
          timeout_seconds,
        );

        // Collect message_reaction updates from the missed array
        const reactions = missed
          .filter((u) => !!(u as any).message_reaction)
          .map((u) => {
            const mr = (u as any).message_reaction;
            const newEmoji = (mr.new_reaction ?? []).filter((r: any) => r.type === "emoji").map((r: any) => r.emoji);
            const oldEmoji = (mr.old_reaction ?? []).filter((r: any) => r.type === "emoji").map((r: any) => r.emoji);
            const user = mr.user ? { id: mr.user.id, name: [mr.user.first_name, mr.user.last_name].filter(Boolean).join(" "), username: mr.user.username } : undefined;
            return { message_id: mr.message_id, user, emoji_added: newEmoji, emoji_removed: oldEmoji };
          });

        if (!match) {
          return toResult({ timed_out: true, reactions: reactions.length ? reactions : undefined });
        }

        if (match.voice) {
          const text = await transcribeWithIndicator(match.voice.file_id, match.message_id).catch((e) => `[transcription failed: ${e.message}]`);
          return toResult({ timed_out: false, message_id: match.message_id, text, voice: true, reply_to_message_id: match.reply_to_message?.message_id ?? undefined, reactions: reactions.length ? reactions : undefined });
        }
        return toResult({
          timed_out: false,
          message_id: match.message_id,
          text: match.text,
          reply_to_message_id: match.reply_to_message?.message_id ?? undefined,
          reactions: reactions.length ? reactions : undefined,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
