import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, pollUntil } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";

/**
 * Long-polls for the next text or voice message in a chat.
 *
 * Voice messages are automatically transcribed via local Whisper and returned
 * as plain text — transparent to the caller.
 */
export function register(server: McpServer) {
  server.tool(
    "wait_for_message",
    "Blocks (long-poll) until a text or voice message is received, then returns it. Voice messages are auto-transcribed. Optionally filter by sender user_id. Returns { timed_out: true } on expiry.",
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
        const { match } = await pollUntil(
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

        if (!match) {
          return toResult({ timed_out: true });
        }

        if (match.voice) {
          const text = await transcribeWithIndicator(match.voice.file_id, match.message_id).catch((e) => `[transcription failed: ${e.message}]`);
          return toResult({ timed_out: false, message_id: match.message_id, text, voice: true });
        }
        return toResult({
          timed_out: false,
          message_id: match.message_id,
          text: match.text,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
