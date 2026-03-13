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

import { getRawApi, resolveChat } from "./telegram.js";
import { resolveParseMode } from "./markdown.js";
import {
  registerSendInterceptor,
  clearSendInterceptor,
  bypassProxy,
} from "./outbound-proxy.js";
import { recordOutgoing, getHighestMessageId, trackMessageId } from "./message-store.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const DEFAULT_FRAMES: readonly string[] = Object.freeze(["`...`", "`·..`", "`.·.`", "`..·`", "`...`"]);

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

/** Look up a named animation preset. Returns undefined if not found. */
export function getPreset(key: string): readonly string[] | undefined {
  return _presets.get(key);
}

/** List all registered preset keys. */
export function listPresets(): string[] {
  return [..._presets.keys()];
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
  cycleTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

let _state: AnimationState | null = null;

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
}

function startTimeoutTimer(): void {
  if (!_state) return;
  if (_state.timeoutTimer) clearTimeout(_state.timeoutTimer);
  _state.timeoutTimer = setTimeout(() => void cancelAnimation(), _state.timeoutMs);
  unrefTimer(_state.timeoutTimer);
}

async function cycleFrame(): Promise<void> {
  if (!_state) return;
  const { chatId, messageId, frames, parseMode } = _state;
  const prevText = frames[_state.frameIndex];
  _state.frameIndex = (_state.frameIndex + 1) % frames.length;
  const text = frames[_state.frameIndex];
  // Identical consecutive frames act as a timing delay — skip the API call
  if (text === prevText) return;
  try {
    await bypassProxy(() =>
      getRawApi().editMessageText(chatId, messageId, text, { parse_mode: parseMode }),
    );
  } catch {
    // Best-effort — animation is cosmetic; swallow failures
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
  timeoutSeconds = 120,
  persistent = false,
): Promise<number> {
  // Cancel any existing animation
  await cancelAnimation();

  const chatId = resolveChat();
  if (typeof chatId !== "number") throw new Error("ALLOWED_USER_ID not configured");

  // Pre-process all frames through Markdown→MarkdownV2 once
  const processed = frames.map((f) => resolveParseMode(f, "Markdown"));
  const processedFrames = processed.map((p) => p.text);
  const parseMode = processed[0]?.parse_mode;

  const firstFrame = processedFrames[0] ?? "⏳";
  const msg = await bypassProxy(() =>
    getRawApi().sendMessage(chatId, firstFrame, { parse_mode: parseMode }),
  );

  // Track the placeholder's message_id so position detection is accurate
  trackMessageId(msg.message_id);

  _state = {
    chatId,
    messageId: msg.message_id,
    persistent,
    rawFrames: frames,
    frames: processedFrames,
    parseMode,
    intervalMs: Math.max(intervalMs, 1000), // Telegram rate limit floor
    timeoutMs: Math.min(timeoutSeconds, 600) * 1000,
    frameIndex: 0,
    cycleTimer: null,
    timeoutTimer: null,
  };

  // Start cycling if multiple frames
  if (frames.length > 1) {
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
      if (!captured) return { intercepted: false };

      // Don't promote messages with inline keyboards (choose, send_confirmation) —
      // editMessageText can't carry reply_markup reliably, and the keyboard UX breaks.
      const hasReplyMarkup = "reply_markup" in opts && opts.reply_markup != null;
      if (hasReplyMarkup) {
        // Restore state — this send won't consume the animation
        _state = captured;
        return { intercepted: false };
      }

      const { chatId: animChatId, messageId, persistent: isPersistent, rawFrames, intervalMs: ivl, timeoutMs } = captured;
      const savedTimeoutSeconds = timeoutMs / 1000;

      // Stop current animation timers (use captured state for timer refs)
      if (captured.cycleTimer) clearInterval(captured.cycleTimer);
      if (captured.timeoutTimer) clearTimeout(captured.timeoutTimer);

      // Position detection: is the animation still the last message?
      const isLastMessage = messageId >= getHighestMessageId();

      if (isLastMessage) {
        // R4: Edit in place — avoids Telegram's visible delete animation
        try {
          await bypassProxy(() =>
            getRawApi().editMessageText(animChatId, messageId, text, opts),
          );
        } catch {
          // Animation message was deleted or unavailable
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
            await startAnimation(rawFrames, ivl, savedTimeoutSeconds, true);
          } catch {
            // Restart failed — animation is cosmetic
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

  return msg.message_id;
}

/**
 * Cancel the active animation. Optionally replace with real text.
 * Returns { cancelled, message_id? }.
 */
export async function cancelAnimation(
  text?: string,
  parseMode?: "Markdown" | "HTML" | "MarkdownV2",
): Promise<{ cancelled: boolean; message_id?: number }> {
  if (!_state) return { cancelled: false };

  const { chatId, messageId } = _state;
  clearTimers();
  _state = null;
  _savedForResume = null;

  // Unregister the proxy interceptor
  clearSendInterceptor();

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
