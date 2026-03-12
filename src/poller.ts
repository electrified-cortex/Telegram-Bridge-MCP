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
import { recordInbound } from "./message-store.js";
import { transcribeVoice } from "./transcribe.js";

const REACT_TRANSCRIBING = "\u270D" as ReactionEmoji;  // ✍
const REACT_QUEUED = "\uD83D\uDE34" as ReactionEmoji;  // 😴

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

async function _pollLoop(): Promise<void> {
  while (_running) {
    try {
      const updates = await getApi().getUpdates({
        offset: getOffset(),
        limit: 100,
        timeout: 25,
        allowed_updates: [...DEFAULT_ALLOWED_UPDATES] as ReadonlyArray<
          Exclude<keyof Update, "update_id">
        >,
      });

      advanceOffset(updates);
      const allowed = filterAllowedUpdates(updates);

      const voiceUpdates: Update[] = [];
      for (const u of allowed) {
        const consumed = await handleIfBuiltIn(u);
        if (consumed) continue;

        if (u.message?.voice) {
          voiceUpdates.push(u);
          continue;
        }

        recordInbound(u);
      }

      // Transcribe voice messages in parallel
      if (voiceUpdates.length > 0) {
        await Promise.all(voiceUpdates.map((u) => _transcribeAndRecord(u)));
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- _running is mutated externally by stopPoller()
      if (!_running) break;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[poller] error: ${msg}\n`);
      // Back off on persistent errors
      await new Promise<void>((r) => setTimeout(r, 5000));
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

    const text = await Promise.race([
      transcribeVoice(msg.voice.file_id),
      new Promise<never>((_, reject) => {
        setTimeout(() => { reject(new Error("transcription timed out (60s)")); }, 60_000);
      }),
    ]);

    // Swap to 😴 (queued)
    const setQueued = await trySetMessageReaction(chatId, messageId, REACT_QUEUED);
    if (!setQueued) process.stderr.write(`[poller] failed to set 😴 on msg ${messageId}\n`);

    recordInbound(u, text);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[poller] transcription error for msg ${messageId}: ${errMsg}\n`);
    recordInbound(u, `[transcription failed: ${errMsg}]`);
    await trySetMessageReaction(chatId, messageId, REACT_QUEUED).catch(() => {});
  }
}
