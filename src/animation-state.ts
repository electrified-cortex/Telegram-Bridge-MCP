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

/** Returns true if the session has a custom animation default set (not the built-in). */
export function hasSessionDefault(sid: number): boolean {
  return _sessionDefaults.has(sid);
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

/**
 * One entry in the priority stack — one slot per session.
 * The top entry (index 0) is what the operator sees in Telegram.
 */
interface StackEntry {
  sid: number;
  priority: number;            // higher = shown first; default 0
  seq: number;                 // insertion sequence — higher = more recently pushed
  persistent: boolean;         // false = temporary (has timeoutMs), true = no timeout
  chatId: number;
  rawFrames: string[];         // original unprocessed frames (for restart)
  frames: string[];            // pre-processed MarkdownV2 text
  parseMode: "HTML" | "MarkdownV2" | undefined;
  intervalMs: number;
  timeoutMs: number;           // 0 for persistent; wall-clock ms from startedAt
  startedAt: number;           // Date.now() at push — for recency ordering + timeout
  notify: boolean;             // disable_notification = !notify on initial send
  frameIndex: number;
  dispatchCount: number;       // counts actual API dispatches; interval doubles every 20
}

/** Priority-ordered stack. [0] = top (displayed). Sort: priority desc, startedAt desc, seq desc. */
const _stack: StackEntry[] = [];

/** Monotonically increasing sequence counter for recency tiebreaking. */
let _entrySeq = 0;

/** The single animation message displayed across all sessions. */
let _displayedChatId: number | null = null;
let _displayedMsgId: number | null = null;

/** Timers for the currently displayed top entry. */
let _cycleTimer: ReturnType<typeof setInterval> | null = null;
let _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let _resumeTimer: ReturnType<typeof setTimeout> | null = null;  // 429 recovery

/** Number of dispatched frames per backoff step — interval doubles at each multiple. */
const DISPATCHES_PER_BACKOFF_STEP = 20;

interface SavedResume {
  rawFrames: string[];
  intervalMs: number;
  timeoutSeconds: number;
  priority: number;
  notify: boolean;
}

/** Saved resume config per session — held during file-send gap or deferred restart. */
const _savedForResumes = new Map<number, SavedResume>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

function stopTimers(): void {
  if (_cycleTimer) { clearInterval(_cycleTimer); _cycleTimer = null; }
  if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
  if (_resumeTimer) { clearTimeout(_resumeTimer); _resumeTimer = null; }
}

function startCycleTimer(entry: StackEntry): void {
  if (_cycleTimer) { clearInterval(_cycleTimer); _cycleTimer = null; }
  if (entry.frames.length > 1) {
    _cycleTimer = setInterval(() => void cycleFrame(), entry.intervalMs);
    unrefTimer(_cycleTimer);
  }
}

function startTopTimeoutTimer(): void {
  if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
  if (_stack.length === 0 || _stack[0].persistent) return;
  const entry = _stack[0];
  const remaining = Math.max(0, (entry.startedAt + entry.timeoutMs) - Date.now());
  _timeoutTimer = setTimeout(() => { _timeoutTimer = null; void cascade(); }, remaining);
  unrefTimer(_timeoutTimer);
}

/** Sort comparator: priority desc, then startedAt desc, then seq desc (all → more = better). */
function compareEntries(a: StackEntry, b: StackEntry): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.startedAt !== a.startedAt) return b.startedAt - a.startedAt;
  return b.seq - a.seq;
}

function getStackEntry(sid: number): StackEntry | undefined {
  return _stack.find(e => e.sid === sid);
}

/** Replace/insert an entry for the given SID, re-sort the stack. */
function pushEntry(entry: StackEntry): void {
  const idx = _stack.findIndex(e => e.sid === entry.sid);
  if (idx !== -1) _stack.splice(idx, 1);
  _stack.push(entry);
  _stack.sort(compareEntries);
}

/** Cycle to the next frame for the top display entry. */
async function cycleFrame(): Promise<void> {
  if (_stack.length === 0 || _displayedMsgId === null) return;
  const entry = _stack[0];
  const msgId = _displayedMsgId;  // capture before await
  const prevFrame = entry.frames[entry.frameIndex];
  entry.frameIndex = (entry.frameIndex + 1) % entry.frames.length;
  const nextFrame = entry.frames[entry.frameIndex];
  // Identical consecutive frames act as a timing delay — skip the API call
  if (nextFrame === prevFrame) return;
  try {
    await bypassProxy(() =>
      getRawApi().editMessageText(entry.chatId, msgId, nextFrame, { parse_mode: entry.parseMode }),
    );
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 429) {
      // Rate-limited — pause cycle timer and resume after retry_after
      const retryAfter = err.parameters.retry_after ?? 60;
      dlog("animation", `429 rate-limited, pausing ${retryAfter}s`, { msgId });
      if (_cycleTimer) { clearInterval(_cycleTimer); _cycleTimer = null; }
      // Cancel any prior resume timer to avoid leaking duplicate intervals
      if (_resumeTimer) clearTimeout(_resumeTimer);
      const capturedEntry = entry;
      _resumeTimer = setTimeout(() => {
        if (_stack[0] !== capturedEntry || _cycleTimer) return;
        _resumeTimer = null;
        startCycleTimer(capturedEntry);
      }, retryAfter * 1000);
      unrefTimer(_resumeTimer);
      return;
    }
    // Other error — animation placeholder gone → cascade to next entry
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[animation] cycleFrame failed for msg ${msgId}, cascading: ${msg}\n`);
    if (_stack[0] !== entry) return;  // state changed; don't cascade on stale error
    _stack.shift();
    _displayedMsgId = null;
    _displayedChatId = null;
    stopTimers();
    clearSendInterceptor(entry.sid);
    await cascade();
    return;
  }
  if (_stack[0] !== entry) return;  // state changed during await
  // Backoff: every DISPATCHES_PER_BACKOFF_STEP dispatches, double the interval
  entry.dispatchCount++;
  if (entry.dispatchCount % DISPATCHES_PER_BACKOFF_STEP === 0) {
    entry.intervalMs *= 2;
    startCycleTimer(entry);
  }
}

/**
 * Update the displayed animation to the given entry.
 * Edits the existing Telegram message if present; otherwise sends a new one.
 */
async function updateDisplay(entry: StackEntry): Promise<void> {
  stopTimers();
  entry.frameIndex = 0;
  const firstFrame = entry.frames[0] ?? "⏳";

  if (_displayedMsgId !== null) {
    // Edit existing message in-place (avoids flicker)
    const existingChatId = _displayedChatId ?? 0;
    const existingMsgId = _displayedMsgId;
    try {
      await bypassProxy(() =>
        getRawApi().editMessageText(existingChatId, existingMsgId, firstFrame, {
          parse_mode: entry.parseMode,
        }),
      );
    } catch {
      // Edit failed — delete the old message to prevent orphaned animation frames
      _displayedMsgId = null;
      _displayedChatId = null;
      bypassProxy(() => getRawApi().deleteMessage(existingChatId, existingMsgId)).catch(() => {});
    }
  }

  if (_displayedMsgId === null) {
    // No existing message — send a fresh one
    process.stderr.write(`[animation] updateDisplay: sending new message for sid=${entry.sid}\n`);
    try {
      await fireTempReactionRestore();
      const msg = await bypassProxy(() =>
        getRawApi().sendMessage(entry.chatId, firstFrame, {
          parse_mode: entry.parseMode,
          disable_notification: !entry.notify,
        }),
      );
      _displayedMsgId = msg.message_id;
      _displayedChatId = entry.chatId;
      trackMessageId(_displayedMsgId);
    } catch (err) {
      // Can't create message — throw so the caller (startAnimation / cascade) can handle cleanup
      throw err;
    }
  }

  startCycleTimer(entry);
  startTopTimeoutTimer();
}

/**
 * Cascade: prune expired top entries, then display the next valid one
 * or delete the animation message if the stack is empty.
 */
async function cascade(): Promise<void> {
  // Remove expired non-persistent entries from the top
  while (_stack.length > 0) {
    const top = _stack[0];
    if (top.persistent) break;  // persistent never expires
    if (top.startedAt + top.timeoutMs > Date.now()) break;  // still valid
    process.stderr.write(`[animation] cascade: pruned expired sid=${top.sid}\n`);
    _stack.shift();
    clearSendInterceptor(top.sid);
  }

  if (_stack.length === 0) {
    process.stderr.write(`[animation] cascade: stack empty — deleting display msg ${_displayedMsgId}\n`);
    // Stack empty — delete the animation message if it still exists
    if (_displayedMsgId !== null) {
      const chatId = _displayedChatId ?? 0;
      const msgId = _displayedMsgId;
      _displayedMsgId = null;
      _displayedChatId = null;
      stopTimers();
      try {
        await bypassProxy(() => getRawApi().deleteMessage(chatId, msgId));
      } catch { /* message already gone — cosmetic */ }
    }
    return;
  }

  // Display the new top entry — if it fails, drop it and cascade to the next
  const next = _stack[0];
  process.stderr.write(`[animation] cascade: promoting sid=${next.sid} priority=${next.priority}\n`);
  try {
    await updateDisplay(next);
  } catch {
    _stack.shift();
    clearSendInterceptor(next.sid);
    await cascade();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start (or replace) a cycling animation message for the given session.
 * Returns the message_id of the displayed animation placeholder.
 *
 * Priority stack: if priority is higher than the current displayed entry,
 * this session takes the display immediately. Otherwise it is queued behind
 * higher-priority entries and becomes visible when they expire or are cancelled.
 */
export async function startAnimation(
  sid: number,
  frames?: string[],
  intervalMs = 1000,
  timeoutSeconds = 600,
  persistent = false,
  allowBreakingSpaces = false,
  notify = false,
  priority = 0,
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

  // Build the new stack entry for this SID
  const entry: StackEntry = {
    sid,
    priority,
    seq: ++_entrySeq,
    persistent,
    chatId,
    rawFrames: paddedFrames,
    frames: processedFrames,
    parseMode,
    intervalMs: Math.max(intervalMs, 1000),  // Telegram rate-limit floor
    timeoutMs: persistent ? 0 : Math.min(timeoutSeconds, 600) * 1000,
    startedAt: Date.now(),
    notify,
    frameIndex: 0,
    dispatchCount: 0,
  };

  // Clean up any stale saved resume for this SID (gap recovery takes priority)
  if (_savedForResumes.has(sid)) _savedForResumes.delete(sid);

  pushEntry(entry);
  const isNowTop = _stack[0].sid === sid;

  dlog("animation", `pushed sid=${sid} priority=${priority} isTop=${isNowTop} frames=${paddedFrames.length} persistent=${persistent}`);

  if (isNowTop) {
    // This session is now displayed — update or create the animation message.
    // If updateDisplay throws, clean up the pushed entry and do NOT register interceptor.
    try {
      await updateDisplay(entry);
    } catch (err) {
      const idx = _stack.findIndex(e => e.sid === sid);
      if (idx !== -1) _stack.splice(idx, 1);
      await cascade();
      throw err;
    }
  }
  // If buried, the display stays on the current top entry; no Telegram action needed.

  // Register the per-SID send interceptor for animation promotion.
  // Guards inside each callback ensure no-ops when this SID is buried.
  registerSendInterceptor(sid, {
    async beforeTextSend(_targetChatId, text, opts) {
      // Guard: only promote if this SID is the currently displayed top
      if (_stack[0]?.sid !== sid || _displayedMsgId === null) {
        process.stderr.write(`[animation] sid=${sid} beforeTextSend: buried or no display, passing through\n`);
        return { intercepted: false };
      }

      // ATOMIC: capture display refs and remove entry from stack synchronously.
      // Any concurrent call for this SID will see _stack[0].sid !== sid and pass through.
      const animMsgId = _displayedMsgId;
      const animChatId = _displayedChatId ?? 0;
      const captured = _stack.shift() as StackEntry;
      _displayedMsgId = null;
      _displayedChatId = null;
      stopTimers();

      process.stderr.write(`[animation] sid=${sid} beforeTextSend: captured top msg=${animMsgId}, persistent=${captured.persistent}\n`);

      // Can't edit-in-place when message has reply context —
      // editMessageText can't add reply threading to an existing message.
      // Delete animation + restart below instead.
      const hasReplyParameters = "reply_parameters" in opts && opts.reply_parameters != null;
      if (hasReplyParameters) {
        if (captured.persistent) {
          _savedForResumes.set(sid, { rawFrames: captured.rawFrames, intervalMs: captured.intervalMs, timeoutSeconds: captured.timeoutMs / 1000, priority: captured.priority, notify: captured.notify });
        } else {
          clearSendInterceptor(sid);
        }
        try {
          await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
        } catch { /* cosmetic */ }
        await cascade();
        return { intercepted: false };
      }

      const savedTimeoutSeconds = captured.timeoutMs / 1000;

      // Position detection: is the animation still the last message?
      const highestMsg = getHighestMessageId();
      const isLastMessage = animMsgId >= highestMsg;
      process.stderr.write(`[animation] sid=${sid} position check: anim=${animMsgId} highest=${highestMsg} isLast=${isLastMessage}\n`);

      if (isLastMessage) {
        // R4: Edit in place — avoids Telegram's visible delete animation
        try {
          await bypassProxy(() =>
            getRawApi().editMessageText(animChatId, animMsgId, text, opts),
          );
          process.stderr.write(`[animation] sid=${sid} R4 edit succeeded for msg ${animMsgId}\n`);
        } catch (editErr) {
          // Best-effort delete to avoid leaving an orphaned placeholder
          try {
            await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
          } catch { /* already gone */ }
          const editMsg = editErr instanceof Error ? editErr.message : String(editErr);
          process.stderr.write(`[animation] sid=${sid} R4 edit FAILED for msg ${animMsgId}: ${editMsg}\n`);
          if (captured.persistent) {
            _savedForResumes.set(sid, { rawFrames: captured.rawFrames, intervalMs: captured.intervalMs, timeoutSeconds: savedTimeoutSeconds, priority: captured.priority, notify: captured.notify });
          } else {
            clearSendInterceptor(sid);
          }
          await cascade();
          return { intercepted: false };
        }

        if (captured.persistent) {
          // Restart animation below the promoted text — inline restart
          try {
            const restartId = await startAnimation(sid, captured.rawFrames, captured.intervalMs, savedTimeoutSeconds, true, false, captured.notify, captured.priority);
            process.stderr.write(`[animation] sid=${sid} persistent restart: new msg ${restartId}\n`);
          } catch (restartErr) {
            const restartMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
            process.stderr.write(`[animation] sid=${sid} persistent restart FAILED: ${restartMsg}\n`);
          }
        } else {
          // Temporary: one-shot — clear interceptor, cascade to next if any
          clearSendInterceptor(sid);
          await cascade();
        }
        return { intercepted: true, message_id: animMsgId };
      }

      // R5: Not last message — delete animation, let proxy send normally
      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
      } catch { /* cosmetic */ }
      if (captured.persistent) {
        _savedForResumes.set(sid, { rawFrames: captured.rawFrames, intervalMs: captured.intervalMs, timeoutSeconds: savedTimeoutSeconds, priority: captured.priority, notify: captured.notify });
      } else {
        clearSendInterceptor(sid);
      }
      await cascade();
      return { intercepted: false };
    },

    async afterTextSend() {
      // ATOMIC: capture and clear this SID's saved resume to prevent re-entrancy
      const resume = _savedForResumes.get(sid);
      _savedForResumes.delete(sid);
      if (!resume) return;
      try {
        await startAnimation(sid, resume.rawFrames, resume.intervalMs, resume.timeoutSeconds, true, false, resume.notify, resume.priority);
      } catch { /* best-effort — animation is cosmetic */ }
    },

    async beforeFileSend() {
      // Only act if this SID is the top (displayed)
      if (_stack[0]?.sid !== sid || _displayedMsgId === null) return;

      // ATOMIC: remove from stack to prevent re-entrancy
      const captured = _stack.shift() as StackEntry;
      const animMsgId = _displayedMsgId;
      const animChatId = _displayedChatId ?? 0;
      _displayedMsgId = null;
      _displayedChatId = null;
      stopTimers();

      try {
        await bypassProxy(() => getRawApi().deleteMessage(animChatId, animMsgId));
      } catch { /* cosmetic */ }

      if (captured.persistent) {
        _savedForResumes.set(sid, { rawFrames: captured.rawFrames, intervalMs: captured.intervalMs, timeoutSeconds: captured.timeoutMs / 1000, priority: captured.priority, notify: captured.notify });
      } else {
        clearSendInterceptor(sid);
      }
      // Do not cascade during the file-send gap; afterFileSend will restore.
    },

    async afterFileSend() {
      const resume = _savedForResumes.get(sid);
      _savedForResumes.delete(sid);
      if (!resume) return;
      try {
        await startAnimation(sid, resume.rawFrames, resume.intervalMs, resume.timeoutSeconds, true, false, resume.notify, resume.priority);
      } catch { /* best-effort */ }
    },

    onEdit() {
      resetAnimationTimeout(sid);
    },
  });

  return isNowTop ? (_displayedMsgId ?? 0) : 0;
}

/**
 * Cancel the active animation for a session. Optionally replace with real text.
 * Returns { cancelled, message_id? }.
 *
 * Only cancels the calling session's own entry — no cross-session cancellation.
 * If the session is buried, its entry is silently removed without affecting the display.
 */
export async function cancelAnimation(
  sid: number,
  text?: string,
  parseMode?: "Markdown" | "HTML" | "MarkdownV2",
): Promise<{ cancelled: boolean; message_id?: number }> {
  const inStack = _stack.some(e => e.sid === sid);
  const inGap = _savedForResumes.has(sid);
  if (!inStack && !inGap) return { cancelled: false };

  const wasTop = inStack && _stack[0]?.sid === sid;

  // Remove entry from stack and resume stash
  const stackIdx = _stack.findIndex(e => e.sid === sid);
  if (stackIdx !== -1) _stack.splice(stackIdx, 1);
  _savedForResumes.delete(sid);
  clearSendInterceptor(sid);

  dlog("animation", `cancelled sid=${sid} wasTop=${wasTop} replacement=${!!text}`);

  if (!inStack) {
    // File-send gap — no displayed message (already deleted in beforeFileSend)
    return { cancelled: true };
  }

  if (!wasTop) {
    // Buried entry — remove silently, display is unaffected
    return { cancelled: true };
  }

  // Was the displayed top — handle the animation message
  stopTimers();

  let replacedMsgId: number | undefined;

  if (text && _displayedMsgId !== null) {
    // Replace the animation placeholder with real content
    const msgId = _displayedMsgId;
    const chatId = _displayedChatId ?? 0;
    _displayedMsgId = null;
    _displayedChatId = null;
    try {
      const resolved = resolveParseMode(text, parseMode ?? "Markdown");
      await bypassProxy(() =>
        getRawApi().editMessageText(chatId, msgId, resolved.text, {
          parse_mode: resolved.parse_mode,
        }),
      );
      recordOutgoing(msgId, "text", text);
      replacedMsgId = msgId;
    } catch {
      // Edit failed — message gone; just clean up
    }
  } else if (_displayedMsgId !== null) {
    // No replacement — delete the ephemeral animation message
    const msgId = _displayedMsgId;
    const chatId = _displayedChatId ?? 0;
    _displayedMsgId = null;
    _displayedChatId = null;
    try {
      await bypassProxy(() => getRawApi().deleteMessage(chatId, msgId));
    } catch { /* cosmetic */ }
  }

  // Cascade to next entry if any remain in the stack
  await cascade();

  return replacedMsgId !== undefined
    ? { cancelled: true, message_id: replacedMsgId }
    : { cancelled: true };
}

/**
 * Reset the animation inactivity timeout for a session. Called by tools that edit
 * existing messages (append_text, edit_message) — the animation
 * stays in place but the timeout is refreshed.
 */
export function resetAnimationTimeout(sid: number): void {
  const entry = getStackEntry(sid);
  if (!entry || entry.persistent) return;
  entry.startedAt = Date.now();            // extend wall-clock countdown
  if (_stack[0]?.sid === sid) {
    startTopTimeoutTimer();                // restart explicit timer for displayed top
  }
}

/**
 * Returns the displayed animation message_id if the given session is the current top,
 * or null if the session is buried or not in the stack.
 */
export function getAnimationMessageId(sid: number): number | null {
  return _stack[0]?.sid === sid ? (_displayedMsgId ?? null) : null;
}

/**
 * Returns true if an animation is currently active (top or buried) for the session.
 * For temporary entries, returns false once wall-clock timeout has elapsed.
 */
export function isAnimationActive(sid: number): boolean {
  const entry = getStackEntry(sid);
  if (!entry) return false;
  if (entry.persistent) return true;
  return entry.startedAt + entry.timeoutMs > Date.now();
}

/** Alias for `isAnimationActive` — used by health-check as a proof-of-life signal. */
export const hasActiveAnimation = isAnimationActive;

/** Returns true if the active animation for the session is persistent (survives show_typing). */
export function isAnimationPersistent(sid: number): boolean {
  return getStackEntry(sid)?.persistent ?? false;
}

/** For testing only: resets all animation state without API calls. */
export function resetAnimationForTest(): void {
  stopTimers();
  _stack.length = 0;
  _entrySeq = 0;
  _displayedMsgId = null;
  _displayedChatId = null;
  _savedForResumes.clear();
  _sessionDefaults.clear();
  _presetsMap.clear();
  clearSendInterceptor();
}
