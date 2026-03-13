import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, validateText, resolveChat, splitMessage, sendVoiceDirect } from "../telegram.js";
import { showTyping } from "../typing-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";

const DESCRIPTION =
  "Synthesizes plain text to speech and sends it as a Telegram voice note. " +
  "Requires TTS_HOST or OPENAI_API_KEY to be configured. " +
  "IMPORTANT: All Markdown formatting and special symbols are stripped before " +
  "synthesis — asterisks, underscores, backticks, brackets, and similar " +
  "characters become noise in audio. Write the text as natural spoken language: " +
  "no bullet points, no headers, no code blocks, no URLs. Punctuation like " +
  "periods and commas helps pacing; everything else should be plain prose.";

export function register(server: McpServer) {
  server.registerTool(
    "send_text_as_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Text to synthesize and send as a voice note."),
        disable_notification: z.boolean().optional().describe("Send silently"),
        reply_to_message_id: z.number().int().optional().describe("Reply to this message ID"),
      },
    },
    async ({ text, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      if (!isTtsEnabled()) {
        return toError({
          code: "TTS_NOT_CONFIGURED",
          message: "TTS is not configured. Set TTS_HOST or OPENAI_API_KEY to use send_text_as_voice.",
        } as const);
      }

      const textErr = validateText(text);
      if (textErr) return toError(textErr);

      const plainText = stripForTts(text);
      if (!plainText)
        return toError({ code: "EMPTY_MESSAGE", message: "Message text is empty after stripping formatting for TTS." } as const);

      const voiceChunks = splitMessage(plainText);
      try {
        const typingSeconds = Math.min(120, Math.max(5, Math.ceil(plainText.length / 20)));
        await showTyping(typingSeconds, "record_voice");
        const message_ids: number[] = [];
        for (let i = 0; i < voiceChunks.length; i++) {
          const ogg = await synthesizeToOgg(voiceChunks[i]);
          const msg = await sendVoiceDirect(chatId, ogg, {
            disable_notification,
            reply_to_message_id: i === 0 ? reply_to_message_id : undefined,
          });
          message_ids.push(msg.message_id);
        }
        if (message_ids.length === 1) {
          return toResult({ message_id: message_ids[0], voice: true });
        }
        return toResult({ message_ids, chunks: message_ids.length, split: true, voice: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("user restricted receiving of voice note messages")) {
          return toError({
            code: "VOICE_RESTRICTED",
            message:
              "Telegram blocked voice delivery — the user's privacy settings restrict voice notes from bots. " +
              "To fix: Telegram → Settings → Privacy and Security → Voice Messages → " +
              "Add Exceptions → Always Allow → add this bot.",
          } as const);
        }
        return toError(err);
      }
    }
  );
}
