/**
 * Background poller — continuously fetches updates from Telegram and feeds
 * them into the message store. Replaces the per-tool polling pattern in V2.
 *
 * Voice messages are transcribed in parallel before entering the store.
 * The three-phase reaction lifecycle (✍ → � → 🫡) is managed across the pipeline:
 *   ✍  = transcribing (set by poller)
 *   😴 = queued, waiting for agent (set by poller after transcription)
 *   🫡 = acknowledged by agent (set by dequeue_update on receipt)
 */

import type { Update } from "grammy/types";
import {
  getApi, getOffset, advanceOffset, filterAllowedUpdates,
  DEFAULT_ALLOWED_UPDATES, trySetMessageReaction,
  type ReactionEmoji,
} from "./telegram.js";
import { handleIfBuiltIn } from "./built-in-commands.js";
import { recordInbound, hasPendingWaiters, patchVoiceText, isMessageConsumed } from "./message-store.js";
import { transcribeVoice } from "./transcribe.js";

const REACT_TRANSCRIBING = "\u270D" as ReactionEmoji;  // ✍
const REACT_QUEUED = "\uD83D\uDE34" as ReactionEmoji;  // 😴

/** Transcription timeout in milliseconds. */
const TRANSCRIPTION_TIMEOUT_MS = 60_000;

/**
 * Grammy's getUpdates accepts ReadonlyArray for allowed_updates, so we cast
 * once here rather than spreading DEFAULT_ALLOWED_UPDATES into a fresh mutable
 * array on every poll iteration.
 */
const ALLOWED_UPDATES = DEFAULT_ALLOWED_UPDATES as ReadonlyArray<
  Exclude<keyof Update, "update_id">
>;

let _running = false;

export function startPoller(): void {
  if (_running) return;
  _running = true;
  void _pollLoop();
}

export function stopPoller(): void {
  _running = false;
}

export function isPollerRunning(): boolean {
  return _running;
}

/** HTTP status codes that indicate the bot token is invalid or revoked. */
const FATAL_STATUS_CODES = new Set([401, 403]);

/** Default backoff on transient errors (ms). */
const DEFAULT_BACKOFF_MS = 5000;

/** Extract an HTTP status from various error shapes. */
function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    return (err as { status: number }).status;
  }
  return undefined;
}

/** Extract retry_after from a 429 error (Telegram rate limit). */
function getRetryAfter(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const params = (err as Record<string, unknown>).parameters;
  if (typeof params === "object" && params !== null) {
    const ra = (params as Record<string, unknown>).retry_after;
    if (typeof ra === "number") return ra;
  }
  return undefined;
}

async function _pollLoop(): Promise<void> {
  while (_running) {
    try {
      const updates = await getApi().getUpdates({
        offset: getOffset(),
        limit: 100,
        timeout: 25,
        allowed_updates: ALLOWED_UPDATES,
      });

      const allowed = filterAllowedUpdates(updates);

      const voiceUpdates: Update[] = [];
      for (const u of allowed) {
        try {
          const consumed = await handleIfBuiltIn(u);
          if (consumed) continue;

          if (u.message?.voice) {
            // Phase 1: record immediately so blocking waiters unblock at once.
            // text is undefined — waiters that require text will stay in their
            // loop until patchVoiceText fires after transcription (phase 2).
            if (recordInbound(u)) voiceUpdates.push(u);
            continue;
          }

          recordInbound(u);
        } catch (perUpdateErr) {
          const msg = perUpdateErr instanceof Error
            ? perUpdateErr.message
            : String(perUpdateErr);
          process.stderr.write(
            `[poller] error processing update ${u.update_id}: ${msg}\n`,
          );
        }
      }

      // Transcribe voice messages in parallel
      if (voiceUpdates.length > 0) {
        await Promise.all(
          voiceUpdates.map((u) => _transcribeAndRecord(u)),
        );
      }

      // Advance offset AFTER processing so failed updates aren't lost
      advanceOffset(updates);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- _running is mutated externally by stopPoller()
      if (!_running) break;

      const status = getErrorStatus(err);
      const msg = err instanceof Error ? err.message : String(err);

      // Fatal: token revoked or bot blocked — stop immediately
      if (status !== undefined && FATAL_STATUS_CODES.has(status)) {
        process.stderr.write(
          `[poller] fatal error (${status}): ${msg} — stopping poller\n`,
        );
        _running = false;
        break;
      }

      // Rate-limited: respect retry_after
      const retryAfter = getRetryAfter(err);
      if (retryAfter !== undefined) {
        process.stderr.write(
          `[poller] rate limited, retrying in ${retryAfter}s\n`,
        );
        await new Promise<void>((r) =>
          setTimeout(r, retryAfter * 1000),
        );
        continue;
      }

      // Transient: log and back off
      process.stderr.write(`[poller] error: ${msg}\n`);
      await new Promise<void>((r) => setTimeout(r, DEFAULT_BACKOFF_MS));
    }
  }
}

async function _transcribeAndRecord(u: Update): Promise<void> {
  const msg = u.message;
  if (!msg?.voice) return;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  try {
    // React ✍ (transcribing)
    const setScribe = await trySetMessageReaction(chatId, messageId, REACT_TRANSCRIBING);
    if (!setScribe) process.stderr.write(`[poller] failed to set ✍ on msg ${messageId}\n`);

    // Race transcription against a hard timeout.
    //
    // The timeout timer MUST be cancelled once the race settles. If we left
    // it alive and transcription won the race, the setTimeout callback would
    // fire ~60 s later and call reject() on an already-resolved Promise.
    // Node ≥15 treats that as an unhandled rejection and can crash the process.
    //
    // Pattern: declare the timer ID outside the Promise so the finally block
    // can reach it, then clear it unconditionally — clearTimeout on an already-
    // elapsed/cancelled timer is a safe no-op.
    let _transcriptionTimer: ReturnType<typeof setTimeout> | undefined;
    const _timeoutPromise = new Promise<never>((_, reject) => {
      _transcriptionTimer = setTimeout(() => {
        const secs = TRANSCRIPTION_TIMEOUT_MS / 1000;
        reject(new Error(`transcription timed out (${secs}s)`));
      }, TRANSCRIPTION_TIMEOUT_MS);
    });

    let text: string;
    try {
      text = await Promise.race([transcribeVoice(msg.voice.file_id), _timeoutPromise]);
    } finally {
      // Cancel the timer so the pending reject() never fires, whether the race
      // resolved (transcription succeeded) or rejected (timeout or other error).
      clearTimeout(_transcriptionTimer);
    }

    // Phase 2: patch transcribed text and notify waiters
    const waiterWaiting = hasPendingWaiters();
    patchVoiceText(messageId, text);

    // Only set 😴 if no waiter is blocking AND the message hasn't already
    // been dequeued by the agent (prevents stale 😴 overwriting 🫡).
    if (!waiterWaiting && !isMessageConsumed(messageId)) {
      const setQueued = await trySetMessageReaction(chatId, messageId, REACT_QUEUED);
      if (!setQueued) process.stderr.write(`[poller] failed to set 😴 on msg ${messageId}\n`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[poller] transcription error for msg ${messageId}: ${errMsg}\n`);
    patchVoiceText(messageId, `[transcription failed: ${errMsg}]`);
    if (!isMessageConsumed(messageId)) {
      await trySetMessageReaction(chatId, messageId, REACT_QUEUED).catch(() => {});
    }
  }
}
