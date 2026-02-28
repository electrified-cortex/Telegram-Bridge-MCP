import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InputFile } from "grammy";
import { existsSync } from "fs";
import { z } from "zod";
import { getApi, toResult, toError, validateCaption, resolveChat, callApi } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { cancelTyping, showTyping } from "../typing-state.js";

export function register(server: McpServer) {
  server.tool(
    "send_audio",
    "Sends an audio file to the Telegram chat. Accepts a local file path, a public HTTPS URL, or a Telegram file_id. Audio files are shown as playable tracks in Telegram with title and performer metadata. For voice notes (recorded speech in ogg/opus), use send_voice instead.",
    {
      audio: z
        .string()
        .describe("Local absolute file path (e.g. /tmp/track.mp3), a public HTTPS URL, or a Telegram file_id"),
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
        .describe("Audio duration in seconds"),
      performer: z
        .string()
        .optional()
        .describe("Track performer / artist name"),
      title: z
        .string()
        .optional()
        .describe("Track title"),
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
    async ({ audio, caption, parse_mode, duration, performer, title, disable_notification, reply_to_message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }

      const resolved = caption
        ? resolveParseMode(caption, parse_mode)
        : { text: undefined, parse_mode: undefined };

      let audioSource: string | InputFile;
      if (audio.startsWith("http://") || audio.startsWith("https://")) {
        audioSource = audio;
      } else if (existsSync(audio)) {
        audioSource = new InputFile(audio);
      } else {
        audioSource = audio; // Assume Telegram file_id
      }

      try {
        await showTyping(60, "upload_document");
        const msg = await callApi(() =>
          getApi().sendAudio(chatId, audioSource, {
            caption: resolved.text,
            parse_mode: resolved.parse_mode,
            duration,
            performer,
            title,
            disable_notification,
            reply_parameters: reply_to_message_id
              ? { message_id: reply_to_message_id }
              : undefined,
          })
        );
        cancelTyping();
        return toResult({
          message_id: msg.message_id,
          file_id: msg.audio?.file_id,
          file_name: msg.audio?.file_name,
          mime_type: msg.audio?.mime_type,
          file_size: msg.audio?.file_size,
          duration: msg.audio?.duration,
          performer: msg.audio?.performer,
          title: msg.audio?.title,
        });
      } catch (err) {
        cancelTyping();
        return toError(err);
      }
    }
  );
}
