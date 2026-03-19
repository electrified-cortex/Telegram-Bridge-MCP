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
import { dlog } from "./debug-log.js";

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

/** Named animation presets registered per session (keyed by SID). */
const _presetsMap = new Map<number, Map<string, readonly string[]>>();

/** Session-level default frames override per session (keyed by SID). */
const _sessionDefaults = new Map<number, readonly string[]>();

/** Returns the currently active default frames for the session (override or built-in). */
export function getDefaultFrames(sid: number): readonly string[] {
  return _sessionDefaults.get(sid) ?? DEFAULT_FRAMES;
}

/** Set session-level default frames for a session. */
export function setSessionDefault(sid: number, frames: readonly string[]): void {
  _sessionDefaults.set(sid, frames);
}

/** Reset session-level default frames back to the built-in default. */
export function resetSessionDefault(sid: number): void {
  _sessionDefaults.delete(sid);
}

/** Register a named animation preset for later recall by key. */
export function registerPreset(sid: number, key: string, frames: readonly string[]): void {
  let map = _presetsMap.get(sid);
  if (!map) { map = new Map(); _presetsMap.set(sid, map); }
  map.set(key, frames);
}

/** Look up a named animation preset. Session presets shadow built-ins with the same key. */
export function getPreset(sid: number, key: string): readonly string[] | undefined {
  return _presetsMap.get(sid)?.get(key) ?? BUILTIN_PRESETS.get(key);
}

/** List all registered session preset keys (custom only, not built-ins). */
export function listPresets(sid: number): string[] {
  return [...(_presetsMap.get(sid)?.keys() ?? [])];
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

/** Animation state per session (keyed by SID). */
const _states = new Map<number, AnimationState>();

/** Number of dispatched frames per backoff step — interval doubles at each multiple. */
const DISPATCHES_PER_BACKOFF_STEP = 20;

interface SavedResume {
  rawFrames: string[];
  intervalMs: number;
  timeoutSeconds: number;
}

/** Saved resume config per session — held during file-send gap. */
const _savedForResumes = new Map<number, SavedResume>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

function clearTimers(sid: number): void {
  const state = _states.get(sid);
  if (!state) return;
  if (state.cycleTimer) { clearInterval(state.cycleTimer); state.cycleTimer = null; }
  if (state.timeoutTimer) { clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
  if (state.resumeTimer) { clearTimeout(state.resumeTimer); state.resumeTimer = null; }
}

function startTimeoutTimer(sid: number): void {
  const state = _states.get(sid);
  if (!state) return;
  if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
  state.timeoutTimer = setTimeout(() => void cancelAnimation(sid), state.timeoutMs);
  unrefTimer(state.timeoutTimer);
}

async function cycleFrame(sid: number): Promise<void> {
  // Capture state synchronously before any await — state may be replaced
  // by cancelAnimation() or the send interceptor while the API call is in-flight.
  const captured = _states.get(sid);
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
      dlog("animation", `429 rate-limited, pausing ${retryAfter}s`, { messageId });
      const s = _states.get(sid);
      if (s?.cycleTimer) { clearInterval(s.cycleTimer); s.cycleTimer = null; }
      // Cancel any prior resume timer to avoid leaking duplicate intervals
      if (s?.resumeTimer) clearTimeout(s.resumeTimer);
      const capturedState = s;
      const timer = setTimeout(() => {
        const cur = _states.get(sid);
        if (!cur || cur !== capturedState || cur.cycleTimer) return;
        cur.resumeTimer = null;
        cur.cycleTimer = setInterval(() => void cycleFrame(sid), cur.intervalMs);
        unrefTimer(cur.cycleTimer);
      }, retryAfter * 1000);
      unrefTimer(timer);
      const cur = _states.get(sid);
      if (cur) cur.resumeTimer = timer;
      return;
    }
    // Any other error — animation placeholder is gone (deleted, expired) — stop cycling
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[animation] cycleFrame sid=${sid} failed for msg ${messageId}, stopping: ${msg}\n`);
    // Only clear state if it still refers to this animation
    if (_states.get(sid) === captured) {
      clearTimers(sid);
      _states.delete(sid);
      _savedForResumes.delete(sid);
      clearSendInterceptor(sid);
    }
    return;
  }
  // Verify state still refers to this animation before mutating
  if (_states.get(sid) !== captured) return;
  // Backoff: every DISPATCHES_PER_BACKOFF_STEP dispatches, double the interval
  captured.dispatchCount++;
  if (captured.dispatchCount % DISPATCHES_PER_BACKOFF_STEP === 0) {
    captured.intervalMs = captured.intervalMs * 2;
    if (captured.cycleTimer) {
      clearInterval(captured.cycleTimer);
      captured.cycleTimer = setInterval(() => void cycleFrame(sid), captured.intervalMs);
      unrefTimer(captured.cycleTimer);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start (or replace) a cycling animation message for the given session.
 * Returns the message_id of the animation placeholder.
 */
export async function startAnimation(
  sid: number,
  frames?: string[],
  intervalMs = 1000,
  timeoutSeconds = 600,
  persistent = false,
  allowBreakingSpaces = false,
  notify = false,
): Promise<number> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") throw new Error("ALLOWED_USER_ID not configured");

  const resolvedFrames = frames ?? [...getDefaultFrames(sid)];

  // Normalize regular spaces → NBSP (U+00A0) so Telegram doesn't trim them.
  // When allowBreakingSpaces is true the caller opts out of this normalisation.
  const normalizedFrames = allowBreakingSpaces
    ? resolvedFrames
    : resolvedFrames.map((f) => f.replace(/ /g, "\u00A0"));

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

  // If an animation is already active for this SID, reuse its message (edit in place)
  // instead of delete + recreate, avoiding visible flicker.
  let messageId: number;
  const existingState = _states.get(sid);
  if (existingState) {
    clearTimers(sid);
    messageId = existingState.messageId;
    try {
      await bypassProxy(() =>
        getRawApi().editMessageText(existingState.chatId, messageId, firstFrame, { parse_mode: parseMode }),
      );
    } catch {
      // Edit failed (message gone?) — fall back to creating a new one
      _states.delete(sid);
      await fireTempReactionRestore(); // treat new animation as an outbound action
      const msg = await bypassProxy(() =>
        getRawApi().sendMessage(chatId, firstFrame, { parse_mode: parseMode, disable_notification: !notify }),
      );
      messageId = msg.message_id;
      trackMessageId(messageId);
    }
  } else {
    // No existing animation for this SID — cancel any stale resume state and create fresh
    if (_savedForResumes.has(sid)) {
      _savedForResumes.delete(sid);
      clearSendInterceptor(sid);
    }
    await fireTempReactionRestore(); // treat new animation as an outbound action
    const msg = await bypassProxy(() =>
      getRawApi().sendMessage(chatId, firstFrame, { parse_mode: parseMode, disable_notification: !notify }),
    );
    messageId = msg.message_id;
    trackMessageId(messageId);
  }

  const newState: AnimationState = {
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
  _states.set(sid, newState);

  dlog("animation", `started sid=${sid} msgId=${messageId} frames=${paddedFrames.length} persistent=${persistent}`);

  // Start cycling if multiple frames
  if (paddedFrames.length > 1) {
    newState.cycleTimer = setInterval(() => void cycleFrame(sid), newState.intervalMs);
    unrefTimer(newState.cycleTimer);
  }

  // Start inactivity timeout
  startTimeoutTimer(sid);

  // Register the per-SID send interceptor for animation promotion
  registerSendInterceptor(sid, {
    async beforeTextSend(targetChatId, text, opts) {
      // ATOMIC: capture and remove this SID's state in one synchronous step.
      // Prevents re-entrancy — only the first concurrent send processes
      // the animation; subsequent sends see no state and go through normal path.
      const captured = _states.get(sid);
      _states.delete(sid);
      if (!captured) {
        process.stderr.write(`[animation] sid=${sid} beforeTextSend: no state, passing through\n`);
        return { intercepted: false };
      }
      process.stderr.write(`[animation] sid=${sid} beforeTextSend: captured msg ${captured.messageId}, persistent=${captured.persistent}\n`);

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
          _savedForResumes.set(sid, { rawFrames, intervalMs: ivl, timeoutSeconds: timeoutMs / 1000 });
        } else {
          clearSendInterceptor(sid);
        }
        try {
          await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
        } catch {
          // Already gone — cosmetic only
        }
        return { intercepted: false };
      }

      const { chatId: animChatId, messageId: anim_messageId, persistent: isPersistent, rawFrames, intervalMs: ivl, timeoutMs } = captured;
      const savedTimeoutSeconds = timeoutMs / 1000;

      // Stop current animation timers (use captured state for timer refs)
      if (captured.cycleTimer) clearInterval(captured.cycleTimer);
      if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);

      // Position detection: is the animation still the last message?
      const highestMsg = getHighestMessageId();
      const isLastMessage = anim_messageId >= highestMsg;
      process.stderr.write(`[animation] sid=${sid} position check: anim=${anim_messageId} highest=${highestMsg} isLast=${isLastMessage}\n`);

      if (isLastMessage) {
        // R4: Edit in place — avoids Telegram's visible delete animation
        try {
          await bypassProxy(() =>
            getRawApi().editMessageText(animChatId, anim_messageId, text, opts),
          );
          process.stderr.write(`[animation] sid=${sid} R4 edit succeeded for msg ${anim_messageId}\n`);
        } catch (editErr) {
          // Animation message may still exist if edit failed for a non-deletion reason.
          // Best-effort delete to avoid leaving an orphaned placeholder (mirrors R5 path).
          try {
            await bypassProxy(() => getRawApi().deleteMessage(animChatId, anim_messageId));
          } catch {
            // Already gone — expected if edit failed because message was deleted
          }
          const editMsg = editErr instanceof Error ? editErr.message : String(editErr);
          process.stderr.write(`[animation] sid=${sid} R4 edit FAILED for msg ${anim_messageId}: ${editMsg}\n`);
          if (isPersistent) {
            // Stash for deferred restart via afterTextSend
            _savedForResumes.set(sid, { rawFrames, intervalMs: ivl, timeoutSeconds: savedTimeoutSeconds });
            return { intercepted: false };
          }
          clearSendInterceptor(sid);
          return { intercepted: false };
        }

        if (isPersistent) {
          // Restart animation below — inline, since we already edited
          try {
            const restartId = await startAnimation(sid, rawFrames, ivl, savedTimeoutSeconds, true);
            process.stderr.write(`[animation] sid=${sid} persistent restart: new msg ${restartId}\n`);
          } catch (restartErr) {
            const restartMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
            process.stderr.write(`[animation] sid=${sid} persistent restart FAILED: ${restartMsg}\n`);
          }
        } else {
          // Temporary: one-shot — done after promotion
          clearSendInterceptor(sid);
        }
        return { intercepted: true, message_id: anim_messageId };
      }

      // Not last message — R5: delete animation, let proxy send normally
      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, anim_messageId));
      } catch {
        // Already gone — cosmetic only
      }
      if (isPersistent) {
        _savedForResumes.set(sid, { rawFrames, intervalMs: ivl, timeoutSeconds: savedTimeoutSeconds });
      } else {
        clearSendInterceptor(sid);
      }
      return { intercepted: false };
    },

    async afterTextSend() {
      // ATOMIC: capture and clear this SID's saved resume to prevent re-entrancy
      const resume = _savedForResumes.get(sid);
      _savedForResumes.delete(sid);
      if (!resume) return;
      const { rawFrames: rf, intervalMs: iv, timeoutSeconds: ts } = resume;
      try {
        await startAnimation(sid, rf, iv, ts, true);
      } catch {
        // Best-effort — animation is cosmetic
      }
    },

    async beforeFileSend() {
      // ATOMIC: capture and remove this SID's state to prevent re-entrancy
      const captured = _states.get(sid);
      _states.delete(sid);
      if (!captured) return;
      // Delete the animation placeholder — can't edit text → file
      const { chatId: animChatId, messageId: anim_messageId, persistent: isPersistent } = captured;
      if (captured.cycleTimer) clearInterval(captured.cycleTimer);
      if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);
      const savedRawFrames = [...captured.rawFrames];
      const savedIntervalMs = captured.intervalMs;
      const savedTimeoutSeconds = captured.timeoutMs / 1000;

      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, anim_messageId));
      } catch {
        // Already gone — cosmetic only
      }

      // Only stash resume config for persistent mode
      if (isPersistent) {
        _savedForResumes.set(sid, { rawFrames: savedRawFrames, intervalMs: savedIntervalMs, timeoutSeconds: savedTimeoutSeconds });
      } else {
        clearSendInterceptor(sid);
      }
    },

    async afterFileSend() {
      // ATOMIC: capture and clear this SID's saved resume to prevent re-entrancy
      const resume = _savedForResumes.get(sid);
      _savedForResumes.delete(sid);
      if (!resume) return;
      const { rawFrames, intervalMs: ivl, timeoutSeconds: ts } = resume;
      try {
        await startAnimation(sid, rawFrames, ivl, ts, true);
      } catch {
        // Best-effort
      }
    },

    onEdit() {
      resetAnimationTimeout(sid);
    },
  });

  return messageId;
}

/**
 * Cancel the active animation for a session. Optionally replace with real text.
 * Returns { cancelled, message_id? }.
 */
export async function cancelAnimation(
  sid: number,
  text?: string,
  parseMode?: "Markdown" | "HTML" | "MarkdownV2",
): Promise<{ cancelled: boolean; message_id?: number }> {
  // Check _savedForResumes too — during a file send, state is deleted but
  // _savedForResumes holds the config for afterFileSend restart.
  if (!_states.has(sid) && !_savedForResumes.has(sid)) return { cancelled: false };

  const state = _states.get(sid);
  const chatId = state?.chatId;
  const messageId = state?.messageId;
  clearTimers(sid);
  _states.delete(sid);
  _savedForResumes.delete(sid);

  dlog("animation", `cancelled sid=${sid} msgId=${messageId ?? "none"} replacement=${!!text}`);

  // Unregister the proxy interceptor for this session
  clearSendInterceptor(sid);

  // state was null (file-send gap) — no message to edit/delete
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
 * Reset the animation inactivity timeout for a session. Called by tools that edit
 * existing messages (append_text, edit_message_text) — the animation
 * stays in place but the timeout is refreshed.
 */
export function resetAnimationTimeout(sid: number): void {
  if (!_states.has(sid)) return;
  startTimeoutTimer(sid);
}

/**
 * Returns the current animation message_id for a session, or null if no animation is active.
 */
export function getAnimationMessageId(sid: number): number | null {
  return _states.get(sid)?.messageId ?? null;
}

/** Returns true if an animation is currently active for the session. */
export function isAnimationActive(sid: number): boolean {
  return _states.has(sid);
}

/** Alias for `isAnimationActive` — used by health-check as a proof-of-life signal. */
export const hasActiveAnimation = isAnimationActive;

/** Returns true if the active animation for the session is persistent (survives show_typing). */
export function isAnimationPersistent(sid: number): boolean {
  return _states.get(sid)?.persistent ?? false;
}

/** For testing only: resets all animation state without API calls. */
export function resetAnimationForTest(): void {
  for (const sid of _states.keys()) clearTimers(sid);
  _states.clear();
  _savedForResumes.clear();
  _sessionDefaults.clear();
  _presetsMap.clear();
  clearSendInterceptor();
}
