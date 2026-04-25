/**
 * Async send queue — per-session serial promise chain for background TTS sends.
 *
 * When a `send` call has `async: true`, the tool returns immediately with a
 * `message_id_pending` (a negative correlation ID). The actual TTS synthesis +
 * Telegram send runs here in the background, and the result is delivered to the
 * session's dequeue stream as a `send_callback` event.
 *
 * Each session has an independent serial promise chain so that async sends from
 * the same session are ordered (no concurrent TTS for the same session). Sessions
 * are independent of each other.
 */

import { synthesizeToOgg } from "./tts.js";
import { sendVoiceDirect, callApi, getApi, splitMessage } from "./telegram.js";
import { deliverAsyncSendCallback, type AsyncSendCallbackPayload } from "./session-queue.js";
import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All fields needed to execute one async TTS+send job. */
export interface AsyncSendJob {
  /** Negative correlation ID assigned at enqueue time. */
  pendingId: number;
  /** Owning session. */
  sid: number;
  /** Target Telegram chat ID. */
  chatId: number;
  /** Plain text for TTS (already stripped of markdown). */
  audioText: string;
  /** Caption text (already converted to MarkdownV2 if provided). */
  captionText: string | undefined;
  /** Whether the caption overflowed and must be sent as a follow-up text message. */
  captionOverflow: boolean;
  /** Resolved TTS voice setting for this session. */
  resolvedVoice: string | undefined;
  /** Resolved TTS speed setting for this session. */
  resolvedSpeed: number | undefined;
  /** Telegram disable_notification flag. */
  disableNotification: boolean | undefined;
  /** reply_to_message_id for the first voice chunk. */
  replyToMessageId: number | undefined;
  /** Unix ms when this job was created. */
  submittedAt: number;
  /** How long (ms) before this job is considered timed out. */
  timeoutMs: number;
}

interface SessionAsyncState {
  /** The current tail of the serial promise chain. */
  tailPromise: Promise<void>;
  /** Monotonically descending counter for pending IDs (starting from -1_000_000_001). */
  nextPendingId: number;
  /** Map of pendingId → job (for cancellation bookkeeping — not currently used for interrupt). */
  jobs: Map<number, AsyncSendJob>;
  /**
   * All pendingIds ever allocated for this session (superset of jobs.keys()).
   * Jobs are removed from `jobs` when they start executing (via .finally()),
   * so iterating `jobs` at cancel time would miss in-flight jobs. This set
   * is populated at enqueue time and never removed from during normal execution —
   * it is the authoritative list for _finalisedJobs cleanup in cancelSessionJobs.
   */
  allAllocatedIds: Set<number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PENDING_ID_START = -1_000_000_001;

// ---------------------------------------------------------------------------
// Finalised-job tracking (prevents double callbacks after timeout race)
// ---------------------------------------------------------------------------

/**
 * Global set of pendingIds that have already had a callback delivered.
 * Guards against the race where runJob() continues executing after the
 * timeout sentinel fires — both the timeout path and the eventual success/
 * failure path may attempt to deliver a callback for the same pendingId.
 *
 * Entries are added after any callback delivery and cleaned up in
 * cancelSessionJobs / resetAsyncSendQueueForTest.
 */
const _finalisedJobs = new Set<number>();

function isFinalisedJob(pendingId: number): boolean {
  return _finalisedJobs.has(pendingId);
}

function markJobFinalised(pendingId: number): void {
  _finalisedJobs.add(pendingId);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const _sessions = new Map<number, SessionAsyncState>();

// ---------------------------------------------------------------------------
// Timeout sentinel
// ---------------------------------------------------------------------------

function timeoutSentinel(ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    const handle = setTimeout(() => { reject(new Error("ASYNC_SEND_TIMEOUT")); }, ms);
    // unref() is a Node.js-only method; prevents the timer from keeping the process alive.
    // The cast is needed because the TypeScript DOM/browser type for NodeJS.Timeout
    // may not include unref() in all target environments.
    (handle as unknown as { unref?: () => void }).unref?.();
  });
}

// ---------------------------------------------------------------------------
// Job executor (runs on the promise chain)
// ---------------------------------------------------------------------------

async function executeJob(job: AsyncSendJob): Promise<void> {
  const {
    pendingId,
    sid,
    chatId,
    captionText,
    disableNotification,
    timeoutMs,
  } = job;

  dlog("async-send", `executing pendingId=${pendingId} sid=${sid}`);

  try {
    // NOTE: runJob() continues executing after the timeout sentinel fires.
    // If runJob eventually succeeds or fails, it will attempt to deliver a
    // callback, but isFinalisedJob() guards will prevent double delivery.
    await Promise.race([
      runJob(job),
      timeoutSentinel(timeoutMs),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === "ASYNC_SEND_TIMEOUT") {
      dlog("async-send", `timeout pendingId=${pendingId} sid=${sid}`);
      // runJob() continues executing after timeout fires; it may still send a
      // voice message to Telegram. The agent receives status:'timeout' but the
      // message may still arrive. This is a known limitation for the first cut.
      if (isFinalisedJob(pendingId)) {
        dlog("async-send", `timeout callback skipped — already finalised pendingId=${pendingId}`);
        return;
      }
      markJobFinalised(pendingId);
      const delivered = deliverAsyncSendCallback(sid, { pendingId, status: "timeout" });
      if (!delivered) {
        process.stderr.write(`[async-send] timeout callback lost for pendingId=${pendingId} sid=${sid} (queue gone)\n`);
      }
      return;
    }

    // Other failure — try plain-text fallback if captionText is available
    dlog("async-send", `failed pendingId=${pendingId} sid=${sid}: ${msg}`);

    if (isFinalisedJob(pendingId)) {
      dlog("async-send", `failed callback skipped — already finalised pendingId=${pendingId}`);
      return;
    }

    let textMessageId: number | undefined;
    let textFallback = false;

    if (captionText) {
      // Send the caption text as plain text (no parse_mode) — captionText may
      // be MarkdownV2-encoded and prepending a raw prefix to encoded MarkdownV2
      // would produce invalid markup. Omitting parse_mode makes Telegram treat
      // the message as plain text, which is safe regardless of encoding.
      try {
        const fallbackText = `⚠ [async failed] ${captionText}`;
        const fallbackMsg = await callApi(() =>
          getApi().sendMessage(chatId, fallbackText, {
            disable_notification: disableNotification,
          } as Record<string, unknown>),
        );
        textMessageId = fallbackMsg.message_id;
        textFallback = true;
      } catch (fbErr) {
        process.stderr.write(
          `[async-send] fallback text send failed for pendingId=${pendingId}: ${String(fbErr)}\n`,
        );
      }
    }

    const payload: AsyncSendCallbackPayload = {
      pendingId,
      status: "failed",
      error: msg,
      textFallback: textFallback || undefined,
      textMessageId,
    };

    markJobFinalised(pendingId);
    const delivered = deliverAsyncSendCallback(sid, payload);
    if (!delivered) {
      process.stderr.write(`[async-send] failed callback lost for pendingId=${pendingId} sid=${sid} (queue gone)\n`);
    }
  }
}

async function runJob(job: AsyncSendJob): Promise<void> {
  const {
    pendingId,
    sid,
    chatId,
    audioText,
    captionText,
    captionOverflow,
    resolvedVoice,
    resolvedSpeed,
    disableNotification,
    replyToMessageId,
  } = job;

  const voiceChunks = splitMessage(audioText);
  const message_ids: number[] = [];

  for (let i = 0; i < voiceChunks.length; i++) {
    const ogg = await synthesizeToOgg(voiceChunks[i], resolvedVoice, resolvedSpeed);
    const isFirst = i === 0;
    const msg = await sendVoiceDirect(chatId, ogg, {
      caption: isFirst && !captionOverflow ? captionText : undefined,
      parse_mode: isFirst && !captionOverflow && captionText ? "MarkdownV2" : undefined,
      disable_notification: disableNotification,
      reply_to_message_id: isFirst ? replyToMessageId : undefined,
    });
    message_ids.push(msg.message_id);
  }

  let textMessageId: number | undefined;
  if (captionOverflow && captionText) {
    const textMsg = await callApi(() =>
      getApi().sendMessage(chatId, captionText, {
        parse_mode: "MarkdownV2",
        disable_notification: disableNotification,
      } as Record<string, unknown>),
    );
    textMessageId = textMsg.message_id;
  }

  const payload: AsyncSendCallbackPayload = {
    pendingId,
    status: "ok",
    ...(message_ids.length === 1 ? { messageId: message_ids[0] } : { messageIds: message_ids }),
    textMessageId,
  };

  if (isFinalisedJob(pendingId)) {
    dlog("async-send", `ok callback skipped — already finalised pendingId=${pendingId} sid=${sid}`);
    return;
  }
  markJobFinalised(pendingId);
  const delivered = deliverAsyncSendCallback(sid, payload);
  if (!delivered) {
    process.stderr.write(`[async-send] ok callback lost for pendingId=${pendingId} sid=${sid} (queue gone)\n`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue an async TTS send job for a session.
 * Appends to the session's serial promise chain (no concurrent sends per session).
 * Returns the negative pending ID assigned to this job.
 */
export function enqueueAsyncSend(
  sid: number,
  jobParams: Omit<AsyncSendJob, "pendingId" | "submittedAt">,
): number {
  let state = _sessions.get(sid);
  if (!state) {
    state = {
      tailPromise: Promise.resolve(),
      nextPendingId: PENDING_ID_START,
      jobs: new Map(),
      allAllocatedIds: new Set(),
    };
    _sessions.set(sid, state);
  }

  const pendingId = state.nextPendingId--;
  const job: AsyncSendJob = {
    ...jobParams,
    pendingId,
    submittedAt: Date.now(),
  };

  state.jobs.set(pendingId, job);
  state.allAllocatedIds.add(pendingId);

  // Capture as const so closures below don't need the non-null assertion.
  const capturedState = state;

  // Chain onto the tail — errors are swallowed here (executor handles them internally)
  capturedState.tailPromise = capturedState.tailPromise.then(
    () => executeJob(job).finally(() => {
      capturedState.jobs.delete(pendingId);
    }),
    () => executeJob(job).finally(() => {
      capturedState.jobs.delete(pendingId);
    }),
  );

  dlog("async-send", `enqueued pendingId=${pendingId} sid=${sid} queue=${capturedState.jobs.size}`);
  return pendingId;
}

/**
 * Signal teardown for a session's async send queue.
 * In-flight jobs will still complete and attempt callback delivery, but may
 * silently discard the callback if the session queue is already gone.
 * This does NOT abort in-flight TTS/Telegram calls.
 */
export function cancelSessionJobs(sid: number): void {
  const state = _sessions.get(sid);
  if (!state) return;
  dlog("async-send", `cancel session sid=${sid} pending=${state.jobs.size}`);
  // Clean up finalised-job entries for this session's pending IDs so the set
  // doesn't grow unboundedly across many session lifecycles.
  // Use allAllocatedIds (not jobs.keys()) because jobs are removed from the map
  // the moment they start executing (via .finally()), so in-flight jobs would be
  // missed if we iterated jobs.keys() here.
  for (const pendingId of state.allAllocatedIds) {
    _finalisedJobs.delete(pendingId);
  }
  _sessions.delete(sid);
  // In-flight jobs continue on the promise chain but will get "queue gone" on delivery
}

/**
 * Reset all async send state. For testing only.
 */
export function resetAsyncSendQueueForTest(): void {
  _sessions.clear();
  _finalisedJobs.clear();
}
