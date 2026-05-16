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
import { pauseTypingEmission, resumeTypingEmission } from "./typing-state.js";
import { markdownToV2 } from "./markdown.js";
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
  /**
   * Original caption text before MarkdownV2 conversion (topic-applied but not yet escaped).
   * Used by the async-fail fallback to render correctly — avoids literal backslash escapes.
   */
  rawCaptionText: string | undefined;
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
    rawCaptionText,
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

    if (rawCaptionText ?? captionText) {
      try {
        let fallbackText: string;
        let fallbackParseMode: "MarkdownV2" | undefined;
        if (rawCaptionText) {
          // Convert raw text fresh to MarkdownV2 so Telegram renders it correctly.
          // The banner brackets must also be V2-escaped (\[ and \]).
          fallbackText = `⚠ \\[async failed\\] ${markdownToV2(rawCaptionText)}`;
          fallbackParseMode = "MarkdownV2";
        } else {
          // rawCaptionText unavailable — send without parse_mode (plain text).
          fallbackText = `⚠ [async failed] ${captionText}`;
          fallbackParseMode = undefined;
        }
        const fallbackMsg = await callApi(() =>
          getApi().sendMessage(chatId, fallbackText, {
            ...(fallbackParseMode ? { parse_mode: fallbackParseMode } : {}),
            disable_notification: disableNotification,
          }),
        );
        textMessageId = fallbackMsg.message_id;
        textFallback = true;
      } catch (fbErr) {
        process.stderr.write(
          `[async-send] fallback text send failed for pendingId=${pendingId}: ${String(fbErr)}\n`,
        );
      }
    }

    const errorCode = (err && typeof err === "object" && "code" in err)
      ? String((err).code)
      : undefined;
    const payload: AsyncSendCallbackPayload = {
      pendingId,
      status: "failed",
      error: msg,
      error_code: errorCode,
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

/** Interval (ms) for re-emitting the record_voice chat action. Telegram auto-expires at ~5 s. */
const RECORD_VOICE_INTERVAL_MS = 4_000;

/**
 * Safety bound (ms) for the recording indicator. If a job hangs and never
 * releases, the indicator is force-cleared after this window. 120 s is
 * deliberately generous — normal audio jobs complete in under 30 s, but
 * very long messages under slow TTS hosts can take longer.
 */
const RECORDING_INDICATOR_SAFETY_MS = 120_000;

// ---------------------------------------------------------------------------
// Per-chatId refcounted recording indicator
// ---------------------------------------------------------------------------

interface RecordingIndicatorState {
  count: number;
  handle: NodeJS.Timeout;
  /** Safety timeout that force-clears the interval if a job never releases. */
  safetyHandle: NodeJS.Timeout;
  /**
   * Monotonically increasing epoch for this chat's recording-indicator lifetime.
   * Incremented each time a fresh indicator is created (count 0 → 1 transition).
   * releaseRecordingIndicator(chatId, epoch) is a no-op if the stored epoch differs,
   * preventing the 120-s safety handler's unconditional delete from being clobbered
   * by a late-arriving release from a job that was associated with an earlier epoch.
   */
  epoch: number;
}

/** Per-chatId monotonically increasing epoch counter. */
const _recordingEpoch = new Map<number, number>();

/**
 * Map of chatId → active recording-indicator state.
 * Multiple concurrent jobs to the same chat share a single interval so there
 * is no flicker between jobs in a batch.
 */
const _recordingIndicators = new Map<number, RecordingIndicatorState>();

/**
 * Increment the refcount for chatId's recording indicator.
 * If this is the first job (count 0 → 1):
 *   - fires `record_voice` immediately and starts the 4-s renewal interval;
 *   - suppresses any concurrent typing emission for this chat;
 *   - schedules a 120-s safety timeout that force-clears everything if a job
 *     hangs and never calls releaseRecordingIndicator.
 * All sendChatAction errors are swallowed (best-effort).
 *
 * Returns an opaque epoch token that must be passed to releaseRecordingIndicator.
 * This prevents the safety timeout's unconditional clear from clobbering a newly
 * acquired indicator when a late-arriving release fires after the safety handler
 * has already cleared the old state and a new job has re-acquired for the same chat.
 */
export function acquireRecordingIndicator(chatId: number): number {
  const existing = _recordingIndicators.get(chatId);
  if (existing) {
    existing.count++;
    // Reset the safety clock on each new acquire so a long batch of sequential
    // jobs doesn't get killed mid-flight by the safety from the first job.
    clearTimeout(existing.safetyHandle);
    // Capture epoch into a closure-local variable so the safety handler can
    // detect if the entry was replaced by a newer indicator before it fires.
    const safetyEpoch = existing.epoch;
    existing.safetyHandle = setTimeout(() => {
      const current = _recordingIndicators.get(chatId);
      if (!current || current.epoch !== safetyEpoch) return; // stale, skip
      clearInterval(current.handle);
      _recordingIndicators.delete(chatId);
      resumeTypingEmission(chatId);
    }, RECORDING_INDICATOR_SAFETY_MS);
    (existing.safetyHandle as unknown as { unref?: () => void }).unref?.();
    return existing.epoch;
  }
  // First job for this chat — assign a new epoch, suppress typing, start interval.
  const epoch = (_recordingEpoch.get(chatId) ?? 0) + 1;
  _recordingEpoch.set(chatId, epoch);
  pauseTypingEmission(chatId);
  getApi().sendChatAction(chatId, "record_voice").catch(() => {});
  const handle = setInterval(() => {
    getApi().sendChatAction(chatId, "record_voice").catch(() => {});
  }, RECORD_VOICE_INTERVAL_MS);
  // Prevent the interval from keeping the process alive if everything else exits.
  (handle as unknown as { unref?: () => void }).unref?.();
  const safetyHandle = setTimeout(() => {
    clearInterval(handle);
    _recordingIndicators.delete(chatId);
    resumeTypingEmission(chatId);
  }, RECORDING_INDICATOR_SAFETY_MS);
  (safetyHandle as unknown as { unref?: () => void }).unref?.();
  _recordingIndicators.set(chatId, { count: 1, handle, safetyHandle, epoch });
  return epoch;
}

/**
 * Decrement the refcount for chatId's recording indicator.
 * When the count reaches 0, the interval and safety timeout are cleared,
 * the map entry is removed, and typing emission is resumed for the chat.
 *
 * The `epoch` parameter must match the epoch returned by the corresponding
 * acquireRecordingIndicator call. If the epoch differs (or the entry is missing),
 * this call is a no-op — it means the safety timeout already cleared the old
 * state and a new job may have re-acquired the indicator for the same chat.
 */
export function releaseRecordingIndicator(chatId: number, epoch: number): void {
  const state = _recordingIndicators.get(chatId);
  if (!state) return;
  // Stale release from a job that belongs to an older indicator lifetime — ignore.
  if (state.epoch !== epoch) return;
  state.count--;
  if (state.count <= 0) {
    clearInterval(state.handle);
    clearTimeout(state.safetyHandle);
    _recordingIndicators.delete(chatId);
    resumeTypingEmission(chatId);
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

  const recordingEpoch = acquireRecordingIndicator(chatId);

  try {
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
  } finally {
    releaseRecordingIndicator(chatId, recordingEpoch);
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

// ---------------------------------------------------------------------------
// Text-after-audio ordering
// ---------------------------------------------------------------------------

/**
 * Returns true if the session has at least one audio job that is queued or
 * currently executing. Used by send.ts to decide whether to gate an outbound
 * text-only message behind the current audio tail.
 */
export function hasInflightAudio(sid: number): boolean {
  const state = _sessions.get(sid);
  return state !== undefined && state.jobs.size > 0;
}

/**
 * Enqueue a text send function after the session's current audio tail.
 * The caller's `fn` receives the assigned negative pending ID and is
 * responsible for delivering an `AsyncSendCallbackPayload` via
 * `deliverAsyncSendCallback` on both success and failure.
 * Any error thrown by `fn` is swallowed so the chain remains viable.
 * Returns the negative pending ID assigned to this text slot.
 */
export function enqueueTextSend(
  sid: number,
  fn: (pendingId: number) => Promise<void>,
): number {
  const state = _sessions.get(sid);
  if (!state) {
    // Session was torn down between hasInflightAudio check and here.
    // Execute immediately (best-effort) so the text is not silently lost.
    const fallbackId = -(Date.now());
    fn(fallbackId).catch(() => {});
    return fallbackId;
  }

  const pendingId = state.nextPendingId--;
  state.allAllocatedIds.add(pendingId);

  const capturedState = state;
  capturedState.tailPromise = capturedState.tailPromise.then(
    () => fn(pendingId).catch(() => {}),
    () => fn(pendingId).catch(() => {}),
  );

  dlog("async-send", `enqueueTextSend pendingId=${pendingId} sid=${sid}`);
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
    // Also remove already-finalised entries: if a timed-out job completes late, the queue is gone so double-delivery is harmless.
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
  // Resume typing emission for every chat that had an active recording indicator before
  // clearing, so suppression state in typing-state.ts does not leak across test resets.
  for (const chatId of _recordingIndicators.keys()) {
    resumeTypingEmission(chatId);
  }
  // Clear any leftover recording-indicator intervals and safety timeouts so fake-timer tests stay clean.
  for (const { handle, safetyHandle } of _recordingIndicators.values()) {
    clearInterval(handle);
    clearTimeout(safetyHandle);
  }
  _recordingIndicators.clear();
  _recordingEpoch.clear();
}

/**
 * Expose recording-indicator map size for white-box testing only.
 * @internal
 */
export function recordingIndicatorCountForTest(): number {
  return _recordingIndicators.size;
}

/**
 * Expose recording-indicator epoch for a specific chatId for white-box testing only.
 * Returns undefined if no indicator is active for the chat.
 * @internal
 */
export function recordingIndicatorEpochForTest(chatId: number): number | undefined {
  return _recordingIndicators.get(chatId)?.epoch;
}
