import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InputFile } from "grammy";
import { existsSync } from "fs";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption, resolveChat, callApi } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";

export function register(server: McpServer) {
  server.tool(
    "send_voice",
    "Sends a voice note to the Telegram chat. The file should be in OGG format encoded with OPUS codec — Telegram will display it as an inline voice message with waveform and playback controls. Accepts a local file path, a public HTTPS URL, or a Telegram file_id.",
    {
      voice: z
        .string()
        .describe("Local absolute file path (e.g. /tmp/voice.ogg), a public HTTPS URL, or a Telegram file_id"),
      caption: z
        .string()
        .optional()
        .describe("Optional caption (up to 1024 chars)"),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
      duration: z
        .number()
        .int()
        .optional()
        .describe("Voice note duration in seconds"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send silently"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID"),
    },
    async ({ voice, caption, parse_mode, duration, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }

      const resolved = caption
        ? resolveParseMode(caption, parse_mode)
        : { text: undefined, parse_mode: undefined };

      let voiceSource: string | InputFile;
      if (voice.startsWith("http://") || voice.startsWith("https://")) {
        voiceSource = voice;
      } else if (existsSync(voice)) {
        voiceSource = new InputFile(voice);
      } else {
        voiceSource = voice; // Assume Telegram file_id
      }

      try {
        cancelTyping();
        const msg = await callApi(() =>
          getApi().sendVoice(chatId, voiceSource, {
            caption: resolved.text,
            parse_mode: resolved.parse_mode,
            duration,
            disable_notification,
            reply_parameters: reply_to_message_id
              ? { message_id: reply_to_message_id }
              : undefined,
          })
        );
        return toResult({
          message_id: msg.message_id,
          file_id: msg.voice?.file_id,
          mime_type: msg.voice?.mime_type,
          file_size: msg.voice?.file_size,
          duration: msg.voice?.duration,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("user restricted receiving of voice note messages")) {
          return toError({
            code: "VOICE_RESTRICTED",
            message:
              "Telegram blocked voice delivery — the user's privacy settings restrict voice notes from bots. " +
              "To fix: Telegram → Settings → Privacy and Security → Voice Messages → " +
              "Add Exceptions → Always Allow → add this bot. " +
              "The base setting can remain as-is; the 'Always Allow' exception is sufficient.",
          } as const);
        }
        return toError(err);
      }
    }
  );
}
