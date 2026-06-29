import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InputFile } from "grammy";
import {
  getApi, toResult, toError, validateCaption, resolveChat,
  callApi, resolveMediaSource, sendVoiceDirect,
} from "../../telegram.js";
import { resolveParseMode } from "../../markdown.js";
import { showTyping, typingGeneration, cancelTypingIfSameGeneration } from "../../typing-state.js";
import { extname } from "path";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { findAbsolutePath, absPathBlockedError } from "../../abs-path-guard.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";
import { getAndDeleteFile } from "../../file-store.js";
import { getSseBaseUrl } from "../../http-mode.js";

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".flac", ".wav"]);
const VOICE_EXTS = new Set([".ogg", ".oga"]);

type FileType = "photo" | "document" | "video" | "audio" | "voice";

function detectType(file: string): FileType {
  // Extract extension from path or URL (strip query params)
  const clean = file.split("?")[0];
  const ext = extname(clean).toLowerCase();
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VOICE_EXTS.has(ext)) return "voice";
  return "document";
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const CDN_WARNING =
  "File persists on Telegram CDN indefinitely. Deleting the message does NOT delete the file. " +
  "Do not send Tier 2/3 content via send_file.";

const DESCRIPTION =
  "Sends a file (photo, document, video, audio, or voice note) to the chat. " +
  "Accepts a local file path, public HTTPS URL, or Telegram file_id. " +
  "Auto-detects the file type by extension when type=\"auto\" (default). " +
  "For file_id inputs, specify type explicitly since there's no extension to detect. " +
  "WARNING: " + CDN_WARNING;

export async function handleSendFile({
  file, type = "auto", caption, parse_mode = "Markdown", duration, performer, title,
  width, height, disable_notification, reply_to, token, safety,
}: {
  file: string;
  type?: "auto" | "photo" | "document" | "video" | "audio" | "voice";
  caption?: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  duration?: number;
  performer?: string;
  title?: string;
  width?: number;
  height?: number;
  disable_notification?: boolean;
  reply_to?: number;
  token: number;
  safety?: "disable";
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  // ── Absolute-path guard for caption ────────────────────────────────────────
  if (caption) {
    const hit = findAbsolutePath(caption);
    if (hit) {
      if (safety !== "disable") {
        return toError(absPathBlockedError(hit));
      }
      deliverServiceMessage(_sid, SERVICE_MESSAGES.ABS_PATH_SAFETY_OVERRIDE);
    }
  }

  if (caption) {
    const capErr = validateCaption(caption);
    if (capErr) return toError(capErr);
  }

  const resolvedCaption = caption
    ? resolveParseMode(caption, parse_mode)
    : { text: undefined, parse_mode: undefined };

  const fileType: FileType = type === "auto" ? detectType(file) : type;

  // Validate media source for all types (rejects http://, path traversal)
  if (fileType !== "voice") {
    const mediaResult = resolveMediaSource(file);
    if ("code" in mediaResult) return toError(mediaResult);
  } else if (typeof file === "string" && file.startsWith("http://")) {
    // Voice bypasses resolveMediaSource for Buffer/file_id paths,
    // but http:// must still be rejected for consistency.
    const voiceResult = resolveMediaSource(file);
    if ("code" in voiceResult) return toError(voiceResult);
  }

  const replyTo = reply_to;
  const replyParams = replyTo
    ? { message_id: replyTo }
    : undefined;

  try {
    switch (fileType) {
      case "photo": {
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        await showTyping(30, "upload_photo");
        const msg = await callApi(() =>
          getApi().sendPhoto(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          caption: msg.caption,
          warning: CDN_WARNING,
        });
      }

      case "video": {
        await showTyping(120, "upload_video");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendVideo(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration, width, height,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          file_id: msg.video.file_id,
          duration: msg.video.duration,
          warning: CDN_WARNING,
        });
      }

      case "audio": {
        await showTyping(60, "upload_document");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendAudio(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration, performer, title,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          file_id: msg.audio.file_id,
          title: msg.audio.title,
          warning: CDN_WARNING,
        });
      }

      case "voice": {
        await showTyping(30, "upload_voice");
        const gen = typingGeneration();
        try {
          const msg = await sendVoiceDirect(chatId, file, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration,
            disable_notification,
            reply_to_message_id: replyTo,
          });
          // Schedule typing cancel after a brief delay so the upload indicator
          // remains visible while the voice renders in chat — non-blocking.
          setTimeout(() => cancelTypingIfSameGeneration(gen), 1000);
          return toResult({
            message_id: msg.message_id,
            file_id: msg.voice?.file_id,
            warning: CDN_WARNING,
          });
        } catch (e) {
          cancelTypingIfSameGeneration(gen);
          throw e;
        }
      }

      case "document":
      default: {
        await showTyping(60, "upload_document");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendDocument(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          file_id: msg.document.file_id,
          file_name: msg.document.file_name,
          warning: CDN_WARNING,
        });
      }
    }
  } catch (err) {
    return toError(err);
  }
}

// ---------------------------------------------------------------------------
// action(type: "send_file") — bridge-URL and SAFE_FILE_DIR file sending
// ---------------------------------------------------------------------------

/**
 * Handler for `action(type: "send_file", url | file_path, ...)`.
 *
 * When `url` is a bridge URL (`http://localhost:<port>/files/<uuid>`), the file
 * is retrieved from the in-memory store directly (no outbound HTTP request).
 * When `url` is an HTTPS URL it is forwarded to Telegram directly (same as the
 * existing `send_file` tool behaviour for HTTPS inputs).
 * When `file_path` is provided the existing SAFE_FILE_DIR check applies.
 */
export async function handleSendFileAction(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const url       = typeof args.url        === "string" ? args.url        : undefined;
  const filePath  = typeof args.file_path  === "string" ? args.file_path  : undefined;
  const caption   = typeof args.caption    === "string" ? args.caption    : undefined;
  const fileName  = typeof args.file_name  === "string" ? args.file_name  : undefined;
  const disableNotification = typeof args.disable_notification === "boolean" ? args.disable_notification : undefined;
  const replyTo   = typeof args.message_id === "number" ? args.message_id : undefined;

  if (!url && !filePath) {
    return toError({
      code: "MISSING_PARAM" as const,
      message: "send_file requires either `url` (bridge URL or HTTPS) or `file_path` (path inside safe dir).",
      hint: "Obtain a bridge URL by POST /files with Authorization: Bearer <token>, then pass the returned url here.",
    });
  }

  if (url) {
    // ── Bridge URL: read from in-memory store directly ─────────────────────
    const base = getSseBaseUrl();
    const bridgePrefix = base ? `${base}/files/` : null;
    if (bridgePrefix && url.startsWith(bridgePrefix)) {
      const uuid = url.slice(bridgePrefix.length);
      const entry = getAndDeleteFile(uuid);
      if (!entry) {
        return toError({
          code: "UNKNOWN" as const,
          message: "File not found or expired in bridge store. The entry may have already been downloaded or its TTL elapsed.",
          hint: "Upload the file again via POST /files to obtain a fresh URL.",
        });
      }
      const resolvedName = fileName ?? "file";
      const inputFile = new InputFile(entry.buffer, resolvedName);
      if (caption) {
        const capErr = validateCaption(caption);
        if (capErr) return toError(capErr);
      }
      const gen = typingGeneration();
      try {
        await showTyping(60, "upload_document");
        const msg = await callApi(() =>
          getApi().sendDocument(chatId, inputFile, {
            caption,
            disable_notification: disableNotification,
            reply_parameters: replyTo !== undefined ? { message_id: replyTo } : undefined,
          }),
        );
        setTimeout(() => cancelTypingIfSameGeneration(gen), 1000);
        return toResult({
          message_id: msg.message_id,
          file_id: msg.document.file_id,
          file_name: msg.document.file_name,
        });
      } catch (err) {
        cancelTypingIfSameGeneration(gen);
        return toError(err);
      }
    }

    // ── HTTPS URL: reject plain HTTP from external hosts ───────────────────
    if (!url.startsWith("https://")) {
      return toError({
        code: "UNKNOWN" as const,
        message: "Only bridge URLs (http://localhost:<port>/files/<uuid>) or HTTPS URLs are accepted. Plain HTTP from external hosts is not allowed.",
        hint: "Upload the file to the bridge via POST /files to get a bridge URL, or host the file on HTTPS.",
      });
    }

    // ── HTTPS URL: delegate to handleSendFile which forwards to Telegram ───
    return handleSendFile({
      file: url,
      type: "auto",
      caption,
      parse_mode: (args.parse_mode as "Markdown" | "HTML" | "MarkdownV2" | undefined) ?? "Markdown",
      disable_notification: disableNotification,
      reply_to: replyTo,
      token: args.token as number,
    });
  }

  // ── file_path: SAFE_FILE_DIR check via handleSendFile ─────────────────────
  // filePath is guaranteed non-null here: the !url && !filePath guard above exits early.
  if (!filePath) {
    return toError({ code: "MISSING_PARAM" as const, message: "file_path is required when url is not provided.", hint: "" });
  }
  return handleSendFile({
    file: filePath,
    type: "auto",
    caption,
    parse_mode: (args.parse_mode as "Markdown" | "HTML" | "MarkdownV2" | undefined) ?? "Markdown",
    disable_notification: disableNotification,
    reply_to: replyTo,
    token: args.token as number,
  });
}

export function register(server: McpServer) {
  server.registerTool(
    "send_file",
    {
      description: DESCRIPTION,
      inputSchema: {
        file: z
          .string()
          .describe("Local path, HTTPS URL, or Telegram file_id"),
        type: z
          .enum(["auto", "photo", "document", "video", "audio", "voice"])
          .default("auto")
          .describe("File type. auto = detect by extension (default)"),
        caption: z
          .string()
          .optional()
          .describe("Optional caption (up to 1024 chars)"),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Caption parse mode"),
        duration: z
          .number()
          .int()
          .optional()
          .describe("Duration in seconds (audio, video, voice)"),
        performer: z
          .string()
          .optional()
          .describe("Performer name (audio only)"),
        title: z
          .string()
          .optional()
          .describe("Track title (audio only)"),
        width: z
          .number()
          .int()
          .optional()
          .describe("Width in pixels (video only)"),
        height: z
          .number()
          .int()
          .optional()
          .describe("Height in pixels (video only)"),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send silently"),
        reply_to: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
        token: TOKEN_SCHEMA,
        safety: z
          .enum(["disable"])
          .optional()
          .describe(
            'Safety override. Pass `safety: "disable"` to bypass the absolute-path block on the caption and send anyway. An operator notification is emitted when this override is used.',
          ),
      },
    },
    handleSendFile,
  );
}
