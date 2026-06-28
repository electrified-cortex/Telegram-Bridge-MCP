/**
 * handleSendMediaGroup — sends 2–10 media items as one Telegram album via sendMediaGroup.
 * Modelled on handleSendFile (src/tools/send/file.ts).
 */
import type {
  InputMediaAudio,
  InputMediaDocument,
  InputMediaPhoto,
  InputMediaVideo,
} from "grammy/types";
import { extname } from "path";
import {
  callApi,
  getApi,
  resolveChat,
  resolveMediaSource,
  toError,
  toResult,
  validateCaption,
} from "../../telegram.js";
import { showTyping } from "../../typing-state.js";
import { requireAuth } from "../../session-gate.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CDN_WARNING =
  "Files persist on Telegram CDN indefinitely. Deleting the message does NOT delete the files. " +
  "Do not send Tier 2/3 content via send album.";

// ---------------------------------------------------------------------------
// Type detection (photo/video/document/audio — no voice for albums)
// ---------------------------------------------------------------------------

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".flac", ".wav"]);

type AlbumItemType = "photo" | "video" | "document" | "audio";

function detectAlbumType(file: string): AlbumItemType {
  const clean = file.split("?")[0] ?? "";
  const ext = extname(clean).toLowerCase();
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "document";
}

// ---------------------------------------------------------------------------
// Handler input type
// ---------------------------------------------------------------------------

export interface AlbumItem {
  file: string;
  type?: AlbumItemType;
  caption?: string;
}

// ---------------------------------------------------------------------------
// handleSendMediaGroup
// ---------------------------------------------------------------------------

export async function handleSendMediaGroup({
  files,
  token,
}: {
  files: AlbumItem[];
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  // ── Count validation ──────────────────────────────────────────────────────
  if (files.length === 1) {
    return toError({
      code: "ALBUM_TOO_FEW" as const,
      message: "Albums require at least 2 files. For a single file, use send_file instead.",
      hint: 'Use type: "file" for a single file attachment.',
    });
  }
  if (files.length === 0) {
    return toError({
      code: "ALBUM_EMPTY" as const,
      message: "No files provided. Albums require 2–10 files.",
      hint: 'Provide a "files" array with 2–10 items.',
    });
  }
  if (files.length > 10) {
    return toError({
      code: "ALBUM_TOO_MANY" as const,
      message: `Albums support at most 10 files (got ${files.length}). Send in batches of 2–10.`,
      hint: 'Split into multiple send(type: "album") calls of ≤10 items each.',
    });
  }

  // ── Resolve effective types ───────────────────────────────────────────────
  const resolvedTypes: AlbumItemType[] = files.map(
    item => item.type ?? detectAlbumType(item.file),
  );

  // ── Type homogeneity check ────────────────────────────────────────────────
  // Rules:
  //   photo + video → OK (visual group)
  //   all document  → OK
  //   all audio     → OK
  //   anything else → MEDIA_GROUP_TYPE_MIX
  const isVisual = (t: AlbumItemType): boolean => t === "photo" || t === "video";
  const allVisual = resolvedTypes.every(isVisual);
  const firstType = resolvedTypes[0];
  const allSameType = resolvedTypes.every(t => t === firstType);

  if (!allVisual && !allSameType) {
    return toError({
      code: "MEDIA_GROUP_TYPE_MIX" as const,
      message:
        "Mixed media types are not allowed in albums. " +
        "Allowed combinations: photo+video together, all documents, or all audio files.",
      hint: "Use photo/video together, or all-document, or all-audio groups.",
    });
  }

  // ── Per-item validation and media source resolution ───────────────────────
  type SupportedInputMedia =
    | InputMediaPhoto
    | InputMediaVideo
    | InputMediaDocument
    | InputMediaAudio;

  const mediaItems: SupportedInputMedia[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const itemType = resolvedTypes[i];

    // Validate caption length
    if (item.caption) {
      const capErr = validateCaption(item.caption);
      if (capErr) return toError(capErr);
    }

    // Resolve media source (enforces SAFE_FILE_DIR / http:// guards)
    const mediaResult = resolveMediaSource(item.file);
    if ("code" in mediaResult) return toError(mediaResult);

    const media = mediaResult.source;
    const caption = item.caption;

    switch (itemType) {
      case "photo":
        mediaItems.push({ type: "photo", media, caption });
        break;
      case "video":
        mediaItems.push({ type: "video", media, caption });
        break;
      case "document":
        mediaItems.push({ type: "document", media, caption });
        break;
      case "audio":
        mediaItems.push({ type: "audio", media, caption });
        break;
    }
  }

  // ── Show typing indicator ─────────────────────────────────────────────────
  await showTyping(60, "upload_document");

  // ── Send album ────────────────────────────────────────────────────────────
  try {
    const messages = await callApi(() =>
      getApi().sendMediaGroup(chatId, mediaItems),
    );
    return toResult({
      message_ids: messages.map(m => m.message_id),
      warning: CDN_WARNING,
    });
  } catch (err) {
    return toError(err);
  }
}
