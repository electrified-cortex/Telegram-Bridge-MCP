/**
 * Animation state — server-managed cycling placeholder messages.
 *
 * The animation system supports the "segmented streaming" pattern:
 *   1. Agent calls show_animation → creates a cycling placeholder
 *   2. Agent sends content via send_text/notify/etc.
 *   3. Outbound proxy intercepts the send, promotes the animation
 *      (edit → real content), and restarts a new animation below
 *   4. Agent calls cancel_animation → trailing animation removed
 *
 * The agent sees none of step 3's mechanics — just show, send, cancel.
 * Tools never import from this module (except show/cancel_animation).
 * The outbound proxy handles promotion transparently.
 */

import { GrammyError } from "grammy";
import { getRawApi, resolveChat } from "./telegram.js";
import { resolveParseMode } from "./markdown.js";
import {
  registerSendInterceptor,
  clearSendInterceptor,
  bypassProxy,
  fireTempReactionRestore,
} from "./outbound-proxy.js";
import { recordOutgoing, getHighestMessageId, trackMessageId } from "./message-store.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const DEFAULT_FRAMES: readonly string[] = Object.freeze(["`\u258e\u00b7\u00b7\u00b7  \u258e`", "`\u258e\u00b7\u00b7   \u258e`", "`\u258e\u00b7    \u258e`", "`\u258e     \u258e`", "`\u258e\u00b7    \u258e`", "`\u258e\u00b7\u00b7   \u258e`"]);

/**
 * Built-in animation presets always available by name.
 * Use `getPreset(key)` — session presets shadow built-ins with the same key.
 */
export const BUILTIN_PRESETS: ReadonlyMap<string, readonly string[]> = new Map([
  ["bounce",    DEFAULT_FRAMES],
  ["dots",      ["`\u258e\u00b7    \u258e`", "`\u258e\u00b7\u00b7   \u258e`", "`\u258e\u00b7\u00b7\u00b7  \u258e`"]],
  ["working",   ["`[   working   ]`", "`[  \u00b7working\u00b7  ]`", "`[ \u00b7\u00b7working\u00b7\u00b7 ]`", "`[\u00b7\u00b7\u00b7working\u00b7\u00b7\u00b7]`", "`[\u00b7\u00b7 working \u00b7\u00b7]`", "`[\u00b7  working  \u00b7]`"]],
  ["thinking",  ["`[   thinking   ]`", "`[  \u00b7thinking\u00b7  ]`", "`[ \u00b7\u00b7thinking\u00b7\u00b7 ]`", "`[\u00b7\u00b7\u00b7thinking\u00b7\u00b7\u00b7]`", "`[\u00b7\u00b7 thinking \u00b7\u00b7]`", "`[\u00b7  thinking  \u00b7]`"]],
  ["loading",   ["`[   loading   ]`", "`[  \u00b7loading\u00b7  ]`", "`[ \u00b7\u00b7loading\u00b7\u00b7 ]`", "`[\u00b7\u00b7\u00b7loading\u00b7\u00b7\u00b7]`", "`[\u00b7\u00b7 loading \u00b7\u00b7]`", "`[\u00b7  loading  \u00b7]`"]],
]);

/** Named animation presets registered during this session. */
const _presets = new Map<string, readonly string[]>();

/** Session-level default frames override. `null` means use DEFAULT_FRAMES. */
let _sessionDefault: readonly string[] | null = null;

/** Returns the currently active default frames (session override or built-in). */
export function getDefaultFrames(): readonly string[] {
  return _sessionDefault ?? DEFAULT_FRAMES;
}

/** Set session-level default frames. `show_animation()` with no args will use these. */
export function setSessionDefault(frames: readonly string[]): void {
  _sessionDefault = frames;
}

/** Reset session-level default frames back to the built-in default. */
export function resetSessionDefault(): void {
  _sessionDefault = null;
}

/** Register a named animation preset for later recall by key. */
export function registerPreset(key: string, frames: readonly string[]): void {
  _presets.set(key, frames);
}

/** Look up a named animation preset. Session presets shadow built-ins with the same key. */
export function getPreset(key: string): readonly string[] | undefined {
  return _presets.get(key) ?? BUILTIN_PRESETS.get(key);
}

/** List all registered session preset keys (custom only, not built-ins). */
export function listPresets(): string[] {
  return [..._presets.keys()];
}

/** List all built-in preset keys. */
export function listBuiltinPresets(): string[] {
  return [...BUILTIN_PRESETS.keys()];
}

interface AnimationState {
  chatId: number;
  messageId: number;
  persistent: boolean;       // false = one-shot (temporary), true = continuous
  rawFrames: string[];       // original unprocessed frames (for restart)
  frames: string[];          // pre-processed MarkdownV2 text
  parseMode: "HTML" | "MarkdownV2" | undefined;
  intervalMs: number;
  timeoutMs: number;
  frameIndex: number;
  dispatchCount: number;     // counts actual API dispatches; interval doubles every 20
  cycleTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  resumeTimer: ReturnType<typeof setTimeout> | null;
}

let _state: AnimationState | null = null;

/** Number of dispatched frames per backoff step — interval doubles at each multiple. */
const DISPATCHES_PER_BACKOFF_STEP = 20;

/** Saved config for resuming animation after a file send. */
let _savedForResume: { rawFrames: string[]; intervalMs: number; timeoutSeconds: number } | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

function clearTimers(): void {
  if (_state?.cycleTimer) {
    clearInterval(_state.cycleTimer);
    _state.cycleTimer = null;
  }
  if (_state?.timeoutTimer) {
    clearTimeout(_state.timeoutTimer);
    _state.timeoutTimer = null;
  }
  if (_state?.resumeTimer) {
    clearTimeout(_state.resumeTimer);
    _state.resumeTimer = null;
  }
}

function startTimeoutTimer(): void {
  if (!_state) return;
  if (_state.timeoutTimer) clearTimeout(_state.timeoutTimer);
  _state.timeoutTimer = setTimeout(() => void cancelAnimation(), _state.timeoutMs);
  unrefTimer(_state.timeoutTimer);
}

async function cycleFrame(): Promise<void> {
  // Capture state synchronously before any await — _state may be nulled/replaced
  // by cancelAnimation() or the send interceptor while the API call is in-flight.
  const captured = _state;
  if (!captured) return;
  const { chatId, messageId, frames, parseMode } = captured;
  const prevText = frames[captured.frameIndex];
  captured.frameIndex = (captured.frameIndex + 1) % frames.length;
  const text = frames[captured.frameIndex];
  // Identical consecutive frames act as a timing delay — skip the API call
  if (text === prevText) return;
  try {
    await bypassProxy(() =>
      getRawApi().editMessageText(chatId, messageId, text, { parse_mode: parseMode }),
    );
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 429) {
      // Rate-limited — pause the cycle timer and resume after retry_after
      const retryAfter = err.parameters.retry_after ?? 60;
      process.stderr.write(`[animation] rate limited, pausing cycle for ${retryAfter}s\n`);
      if (_state?.cycleTimer) {
        clearInterval(_state.cycleTimer);
        _state.cycleTimer = null;
      }
      // Cancel any prior resume timer to avoid leaking duplicate intervals
      if (_state?.resumeTimer) clearTimeout(_state.resumeTimer);
      const captured429 = _state;
      const timer = setTimeout(() => {
        if (!_state || _state !== captured429 || _state.cycleTimer) return;
        _state.resumeTimer = null;
        _state.cycleTimer = setInterval(() => void cycleFrame(), _state.intervalMs);
        unrefTimer(_state.cycleTimer);
      }, retryAfter * 1000);
      unrefTimer(timer);
      if (_state) _state.resumeTimer = timer;
      return;
    }
    // Any other error — animation placeholder is gone (deleted, expired) — stop cycling
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[animation] cycleFrame failed for msg ${messageId}, stopping: ${msg}\n`);
    // Only clear global state if it still refers to this animation
    if (_state === captured) {
      clearTimers();
      _state = null;
      _savedForResume = null;
      clearSendInterceptor();
    }
    return;
  }
  // Verify _state still refers to this animation before mutating
  if (_state !== captured) return;
  // Backoff: every DISPATCHES_PER_BACKOFF_STEP dispatches, double the interval
  captured.dispatchCount++;
  if (captured.dispatchCount % DISPATCHES_PER_BACKOFF_STEP === 0) {
    captured.intervalMs = captured.intervalMs * 2;
    if (captured.cycleTimer) {
      clearInterval(captured.cycleTimer);
      captured.cycleTimer = setInterval(() => void cycleFrame(), captured.intervalMs);
      unrefTimer(captured.cycleTimer);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start (or replace) a cycling animation message.
 * Returns the message_id of the animation placeholder.
 */
export async function startAnimation(
  frames: string[] = [...getDefaultFrames()],
  intervalMs = 1000,
  timeoutSeconds = 600,
  persistent = false,
  allowBreakingSpaces = false,
  notify = false,
): Promise<number> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") throw new Error("ALLOWED_USER_ID not configured");

  // Normalize regular spaces → NBSP (U+00A0) so Telegram doesn't trim them.
  // When allowBreakingSpaces is true the caller opts out of this normalisation.
  const normalizedFrames = allowBreakingSpaces
    ? frames
    : frames.map((f) => f.replace(/ /g, "\u00A0"));

  // Pad all frames to equal length with non-breaking spaces (U+00A0) so
  // cycling frames don't shift the message layout in Telegram.
  // For backtick code spans, insert NBSP inside the closing ` so Telegram
  // preserves them in the monospace run (outside-backtick NBSP gets trimmed).
  const maxLen = Math.max(...normalizedFrames.map((f) => f.length));
  const paddedFrames = normalizedFrames.map((f) => {
    const pad = "\u00A0".repeat(maxLen - f.length);
    if (pad.length === 0) return f;
    if (f.startsWith("`") && f.endsWith("`") && f.length >= 2) {
      return f.slice(0, -1) + pad + "`";
    }
    return f + pad;
  });

  // Pre-process all frames through Markdown→MarkdownV2 once
  const processed = paddedFrames.map((f) => resolveParseMode(f, "Markdown"));
  const processedFrames = processed.map((p) => p.text);
  const parseMode = processed[0]?.parse_mode;

  const firstFrame = processedFrames[0] ?? "⏳";

  // If an animation is already active, reuse its message (edit in place)
  // instead of delete + recreate, avoiding visible flicker.
  let messageId: number;
  if (_state) {
    clearTimers();
    const state = _state; // capture before try — TS can't narrow through function calls
    messageId = state.messageId;
    try {
      await bypassProxy(() =>
        getRawApi().editMessageText(state.chatId, messageId, firstFrame, { parse_mode: parseMode }),
      );
    } catch {
      // Edit failed (message gone?) — fall back to creating a new one
      _state = null;
      await fireTempReactionRestore(); // treat new animation as an outbound action
      const msg = await bypassProxy(() =>
        getRawApi().sendMessage(chatId, firstFrame, { parse_mode: parseMode, disable_notification: !notify }),
      );
      messageId = msg.message_id;
      trackMessageId(messageId);
    }
  } else {
    // No existing animation — cancel any stale resume state and create fresh
    if (_savedForResume) {
      _savedForResume = null;
      clearSendInterceptor();
    }
    await fireTempReactionRestore(); // treat new animation as an outbound action
    const msg = await bypassProxy(() =>
      getRawApi().sendMessage(chatId, firstFrame, { parse_mode: parseMode, disable_notification: !notify }),
    );
    messageId = msg.message_id;
    trackMessageId(messageId);
  }

  _state = {
    chatId,
    messageId,
    persistent,
    rawFrames: paddedFrames,
    frames: processedFrames,
    parseMode,
    intervalMs: Math.max(intervalMs, 1000), // Telegram rate limit floor
    timeoutMs: Math.min(timeoutSeconds, 600) * 1000,
    frameIndex: 0,
    dispatchCount: 0,
    cycleTimer: null,
    timeoutTimer: null,
    resumeTimer: null,
  };

  // Start cycling if multiple frames
  if (paddedFrames.length > 1) {
    _state.cycleTimer = setInterval(() => void cycleFrame(), _state.intervalMs);
    unrefTimer(_state.cycleTimer);
  }

  // Start inactivity timeout
  startTimeoutTimer();

  // Register the send interceptor for animation promotion
  registerSendInterceptor({
    async beforeTextSend(targetChatId, text, opts) {
      // ATOMIC: capture and clear _state in one synchronous step.
      // Prevents re-entrancy — only the first concurrent send processes
      // the animation; subsequent sends see null and go through normal path.
      const captured = _state;
      _state = null;
      if (!captured) {
        process.stderr.write(`[animation] beforeTextSend: no _state, passing through\n`);
        return { intercepted: false };
      }
      process.stderr.write(`[animation] beforeTextSend: captured msg ${captured.messageId}, persistent=${captured.persistent}\n`);

      // Can't edit-in-place when message has reply context —
      // editMessageText can't add reply threading to an existing message.
      // Delete animation + restart below instead.
      const hasReplyParameters = "reply_parameters" in opts && opts.reply_parameters != null;
      if (hasReplyParameters) {
        const { chatId: animChatId, messageId: animMsgId, persistent: isPersistent, rawFrames, intervalMs: ivl, timeoutMs } = captured;
        if (captured.cycleTimer) clearInterval(captured.cycleTimer);
        if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);
        // Stash resume config BEFORE the yield point — mirrors beforeFileSend pattern.
        if (isPersistent) {
          _savedForResume = { rawFrames, intervalMs: ivl, timeoutSeconds: timeoutMs / 1000 };
        } else {
          clearSendInterceptor();
        }
        try {
          await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
        } catch {
          // Already gone — cosmetic only
        }
        return { intercepted: false };
      }

      const { chatId: animChatId, messageId, persistent: isPersistent, rawFrames, intervalMs: ivl, timeoutMs } = captured;
      const savedTimeoutSeconds = timeoutMs / 1000;

      // Stop current animation timers (use captured state for timer refs)
      if (captured.cycleTimer) clearInterval(captured.cycleTimer);
      if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);

      // Position detection: is the animation still the last message?
      const highestMsg = getHighestMessageId();
      const isLastMessage = messageId >= highestMsg;
      process.stderr.write(`[animation] position check: anim=${messageId} highest=${highestMsg} isLast=${isLastMessage}\n`);

      if (isLastMessage) {
        // R4: Edit in place — avoids Telegram's visible delete animation
        try {
          await bypassProxy(() =>
            getRawApi().editMessageText(animChatId, messageId, text, opts),
          );
          process.stderr.write(`[animation] R4 edit succeeded for msg ${messageId}\n`);
        } catch (editErr) {
          // Animation message may still exist if edit failed for a non-deletion reason.
          // Best-effort delete to avoid leaving an orphaned placeholder (mirrors R5 path).
          try {
            await bypassProxy(() => getRawApi().deleteMessage(animChatId, messageId));
          } catch {
            // Already gone — expected if edit failed because message was deleted
          }
          const editMsg = editErr instanceof Error ? editErr.message : String(editErr);
          process.stderr.write(`[animation] R4 edit FAILED for msg ${messageId}: ${editMsg}\n`);
          if (isPersistent) {
            // Stash for deferred restart via afterTextSend
            _savedForResume = { rawFrames, intervalMs: ivl, timeoutSeconds: savedTimeoutSeconds };
            return { intercepted: false };
          }
          clearSendInterceptor();
          return { intercepted: false };
        }

        if (isPersistent) {
          // Restart animation below — inline, since we already edited
          try {
            const restartId = await startAnimation(rawFrames, ivl, savedTimeoutSeconds, true);
            process.stderr.write(`[animation] persistent restart: new msg ${restartId}\n`);
          } catch (restartErr) {
            const restartMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
            process.stderr.write(`[animation] persistent restart FAILED: ${restartMsg}\n`);
          }
        } else {
          // Temporary: one-shot — done after promotion
          clearSendInterceptor();
        }
        return { intercepted: true, message_id: messageId };
      }

      // Not last message — R5: delete animation, let proxy send normally
      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, messageId));
      } catch {
        // Already gone — cosmetic only
      }
      if (isPersistent) {
        _savedForResume = { rawFrames, intervalMs: ivl, timeoutSeconds: savedTimeoutSeconds };
      } else {
        clearSendInterceptor();
      }
      return { intercepted: false };
    },

    async afterTextSend() {
      // ATOMIC: capture and clear _savedForResume to prevent re-entrancy
      const resume = _savedForResume;
      _savedForResume = null;
      if (!resume) return;
      const { rawFrames: rf, intervalMs: iv, timeoutSeconds: ts } = resume;
      try {
        await startAnimation(rf, iv, ts, true);
      } catch {
        // Best-effort — animation is cosmetic
      }
    },

    async beforeFileSend() {
      // ATOMIC: capture and clear to prevent re-entrancy
      const captured = _state;
      _state = null;
      if (!captured) return;
      // Delete the animation placeholder — can't edit text → file
      const { chatId: animChatId, messageId, persistent: isPersistent } = captured;
      if (captured.cycleTimer) clearInterval(captured.cycleTimer);
      if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);
      const savedRawFrames = [...captured.rawFrames];
      const savedIntervalMs = captured.intervalMs;
      const savedTimeoutSeconds = captured.timeoutMs / 1000;

      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, messageId));
      } catch {
        // Already gone — cosmetic only
      }

      // Only stash resume config for persistent mode
      if (isPersistent) {
        _savedForResume = { rawFrames: savedRawFrames, intervalMs: savedIntervalMs, timeoutSeconds: savedTimeoutSeconds };
      } else {
        clearSendInterceptor();
      }
    },

    async afterFileSend() {
      // ATOMIC: capture and clear to prevent re-entrancy
      const resume = _savedForResume;
      _savedForResume = null;
      if (!resume) return;
      const { rawFrames, intervalMs: ivl, timeoutSeconds: ts } = resume;
      try {
        await startAnimation(rawFrames, ivl, ts, true);
      } catch {
        // Best-effort
      }
    },

    onEdit() {
      resetAnimationTimeout();
    },
  });

  return messageId;
}

/**
 * Cancel the active animation. Optionally replace with real text.
 * Returns { cancelled, message_id? }.
 */
export async function cancelAnimation(
  text?: string,
  parseMode?: "Markdown" | "HTML" | "MarkdownV2",
): Promise<{ cancelled: boolean; message_id?: number }> {
  // Check _savedForResume too — during a file send, _state is null but
  // _savedForResume holds the config for afterFileSend restart.
  if (!_state && !_savedForResume) return { cancelled: false };

  const chatId = _state?.chatId;
  const messageId = _state?.messageId;
  clearTimers();
  _state = null;
  _savedForResume = null;

  // Unregister the proxy interceptor
  clearSendInterceptor();

  // _state was null (file-send gap) — no message to edit/delete
  if (chatId === undefined || messageId === undefined) return { cancelled: true };

  if (text) {
    // Replace animation with real content — message becomes permanent
    try {
      const resolved = resolveParseMode(text, parseMode ?? "Markdown");
      await bypassProxy(() =>
        getRawApi().editMessageText(chatId, messageId, resolved.text, {
          parse_mode: resolved.parse_mode,
        }),
      );
      recordOutgoing(messageId, "text", text);
      return { cancelled: true, message_id: messageId };
    } catch {
      // If edit fails (message deleted?), just clean up
      return { cancelled: true };
    }
  }

  // No replacement — delete the ephemeral message
  try {
    await bypassProxy(() => getRawApi().deleteMessage(chatId, messageId));
  } catch {
    // Already deleted or expired — cosmetic only
  }
  return { cancelled: true };
}

/**
 * Reset the animation inactivity timeout. Called by tools that edit
 * existing messages (append_text, edit_message_text) — the animation
 * stays in place but the timeout is refreshed.
 */
export function resetAnimationTimeout(): void {
  if (!_state) return;
  startTimeoutTimer();
}

/**
 * Returns the current animation message_id, or null if no animation is active.
 */
export function getAnimationMessageId(): number | null {
  return _state?.messageId ?? null;
}

/** Returns true if an animation is currently active. */
export function isAnimationActive(): boolean {
  return _state !== null;
}

/** Returns true if the active animation is persistent (survives show_typing). */
export function isAnimationPersistent(): boolean {
  return _state?.persistent ?? false;
}

/** For testing only: resets animation state without API calls. */
export function resetAnimationForTest(): void {
  clearTimers();
  _state = null;
  _savedForResume = null;
  _sessionDefault = null;
  _presets.clear();
  clearSendInterceptor();
}
