/**
 * Always-on message store — the core of V3.
 *
 * Two access patterns over one set of objects:
 *   1. Timeline: ordered event log (dump_session_record)
 *   2. Index:    Map<message_id, Map<version, event>> (get_message)
 *
 * Both point to the same TimelineEvent objects — no duplication.
 *
 * Design:
 *   - Rolling limit on timeline events + message_id index
 *   - Version -1 is always "current"; 0, 1, 2… are edit history (bot only)
 *   - Two-lane queue: response lane (reactions, callbacks) drains before
 *     message lane (new messages, commands, media)
 *   - Bot-sent messages are indexed + logged but NOT enqueued
 *   - User edits silently overwrite -1; no version history, no enqueue
 *   - Bot reactions logged to timeline
 */

import type { Update } from "grammy/types";
import { recordUpdate, recordBotMessage } from "./session-recording.js";
import { getCallerSid, runInSessionContext } from "./session-context.js";
import { TemporalQueue } from "./temporal-queue.js";
import { routeToSession, trackMessageOwner, notifySessionWaiters, sessionQueueCount } from "./session-queue.js";
import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Content payload — event-specific fields tucked under one key. */
export interface EventContent {
  type: string;
  text?: string;
  caption?: string;
  name?: string;
  mime?: string;
  emoji?: string;
  data?: string;
  /** Callback query ID — needed for answer_callback_query. */
  qid?: string;
  /** Message ID this event references (reactions, callbacks). */
  target?: number;
  /** Version of the target message (callbacks on edited bot messages). */
  target_version?: number;
  /** Reaction emoji added. */
  added?: string[];
  /** Reaction emoji removed. */
  removed?: string[];
  /** Message ID this is a reply to (user replied to a specific message). */
  reply_to?: number;
  /** Telegram file_id for downloadable media (doc, photo, video, audio, voice, animation). */
  file_id?: string;
  /** Lifecycle event type — set for service_message events. */
  event_type?: string;
  /** Structured details — set for service_message events. */
  details?: Record<string, unknown>;
  /**
   * SID of the session that explicitly routed this message via `route_message`.
   * Server-injected — cannot be forged by any agent. Absent if the event
   * arrived naturally (not via governor delegation).
   */
  routed_by?: number;
}

/**
 * A single event in the timeline. Same object is referenced by both
 * the ordered timeline array and the message_id index map.
 */
export interface TimelineEvent {
  /** Message ID this event relates to. */
  id: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Event type: message, sent, reaction, callback, edit, user_edit. */
  event: string;
  /** Who originated: "user", "bot", or "system" (server-injected service messages). */
  from: "user" | "bot" | "system";
  /** Event-specific payload. */
  content: EventContent;
  /** Session ID that produced this event (0 or absent = single-session). */
  sid?: number;
  /** Raw Telegram update — stored for get_message full detail. */
  _update?: Update;
}

/** Queued reference to a timeline event. */
interface QueueItem {
  event: TimelineEvent;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum events in the timeline. */
const MAX_TIMELINE = 1000;

/** Maximum unique message_ids in the index. */
const MAX_MESSAGES = 500;

/** Version key for the current (latest) state of a message. */
export const CURRENT = -1;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Ordered event log — the canonical store. */
let _timeline: TimelineEvent[] = [];

/** message_id → (version → TimelineEvent) — index into the same objects. */
let _index = new Map<number, Map<number, TimelineEvent>>();

/** Insertion-ordered list of message_ids for index eviction. */
let _insertionOrder: number[] = [];

/** Highwater mark — highest message_id seen (from any source). */
let _highestMessageId = 0;

/** Per-message bot reaction index — tracks the current bot reaction for restore. */
const _botReactionIndex = new Map<number, string>();

/**
 * Tracks messages that have already had the implicit 👌 base reaction inserted.
 * Key format: `${chatId}:${messageId}`.
 */
const _baseReactionMessages = new Set<string>();

/** Optional callback fired after every timeline push. Used by auto-dump. */
let _onEventCallback: ((timelineSize: number) => void) | null = null;

/** Register a callback that fires after every timeline event push. */
export function setOnEvent(callback: ((timelineSize: number) => void) | null): void {
  _onEventCallback = callback;
}

/** Optional callback fired after every timeline push for local logging. Independent of auto-dump. */
let _onLocalLogCallback: ((event: TimelineEvent) => void) | null = null;

/** Register a callback that receives every new timeline event for local logging. */
export function setOnLocalLog(callback: ((event: TimelineEvent) => void) | null): void {
  _onLocalLogCallback = callback;
}

/** A queue item is ready unless it's a voice message still waiting for text. */
function isQueueItemReady(item: QueueItem): boolean {
  const c = item.event.content;
  return !(c.type === "voice" && c.text === undefined);
}

/** Heavyweight events act as temporal batch delimiters in the queue. */
function isQueueItemHeavyweight(item: QueueItem): boolean {
  const e = item.event;
  return e.event === "message" && (e.content.type === "text" || e.content.type === "voice");
}

/** Temporal queue — events delivered in arrival order; heavyweights delimit batches. */
const _queue = new TemporalQueue<QueueItem>({
  isHeavyweight: isQueueItemHeavyweight,
  isReady: isQueueItemReady,
  getId: (item) => item.event.id,
});

/** Returns true if the given message_id has already been dequeued. */
export function isMessageConsumed(messageId: number): boolean {
  return _queue.isConsumed(messageId);
}

/**
 * One-shot hooks registered by send_choice for auto-lock. Fired on the first
 * callback_query for the target messageId, then removed. The event is still
 * enqueued normally so dequeue will see it.
 */
type CallbackHookFn = (event: TimelineEvent) => void;
const _callbackHooks = new Map<number, CallbackHookFn>();

/** tracks which session registered each callback hook (for teardown). */
const _callbackHookOwners = new Map<number, number>();

/**
 * One-shot hooks that fire on the first *message* with id > the registered
 * afterId. Used by confirm/choose to clean up stale buttons after a timeout
 * when the user sends a text/voice/command instead of pressing a button.
 * Non-consuming: the event stays queued for dequeue.
 */
type MessageHookFn = () => void;
const _messageHooks = new Map<number, MessageHookFn>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

/** Evict oldest timeline events when over capacity. */
function evictTimeline(): void {
  while (_timeline.length > MAX_TIMELINE) {
    const evicted = _timeline.shift();
    if (evicted) dlog("route", `timeline evict id=${evicted.id}`);
  }
}

/** Evict the oldest message_id from the index when over capacity. */
function evictIndex(): void {
  while (_insertionOrder.length > MAX_MESSAGES) {
    const oldest = _insertionOrder.shift();
    if (oldest !== undefined) {
      _index.delete(oldest);
      dlog("route", `index evict msgId=${oldest}`);
    }
  }
}

/** Get or create the version map for a message_id. */
function getOrCreateVersions(
  messageId: number,
): Map<number, TimelineEvent> {
  let versions = _index.get(messageId);
  if (!versions) {
    versions = new Map();
    _index.set(messageId, versions);
    _insertionOrder.push(messageId);
    evictIndex();
  }
  return versions;
}

/** Push an event to the timeline + index as CURRENT for its message_id. */
function pushEvent(event: TimelineEvent): void {
  _timeline.push(event);
  evictTimeline();
  const versions = getOrCreateVersions(event.id);
  versions.set(CURRENT, event);
  if (event.id > _highestMessageId) _highestMessageId = event.id;
  if (_onEventCallback) _onEventCallback(_timeline.length);
  if (_onLocalLogCallback) {
    try { _onLocalLogCallback(event); } catch { /* isolate logging failures */ }
  }
}

// ---------------------------------------------------------------------------
// Inbound updates (from Telegram poller)
// ---------------------------------------------------------------------------

/**
 * Records an inbound update and enqueues it for dequeue.
 *
 * - Regular messages → message lane
 * - Callback queries, reactions → response lane
 * - Edited messages → silently update store, NOT enqueued
 *
 * @param transcribedText — Pre-transcribed text for voice messages.
 *   The poller transcribes voice before calling recordInbound so the
 *   agent never blocks on transcription.
 */
export function recordInbound(update: Update, transcribedText?: string): boolean {
  recordUpdate(update);

  // --- Edited message: silent store update, no enqueue ---
  if (update.edited_message) {
    const msgId = update.edited_message.message_id;
    dlog("route", `inbound edit id=${msgId}`);
    const evt: TimelineEvent = {
      id: msgId,
      timestamp: now(),
      event: "user_edit",
      from: "user",
      content: {
        type: update.edited_message.text ? "text" : "other",
        text: update.edited_message.text,
        caption: update.edited_message.caption,
      },
      _update: update,
    };
    _timeline.push(evt);
    evictTimeline();
    // Overwrite current in index — no version history for user edits
    const versions = _index.get(msgId);
    if (versions) versions.set(CURRENT, evt);
    return true;
  }

  // --- Callback query ---
  if (update.callback_query) {
    const cq = update.callback_query;
    const targetId = cq.message
      ? ("message_id" in cq.message ? cq.message.message_id : 0)
      : 0;
    dlog("route", `inbound callback target=${targetId}`, { data: cq.data });
    const evt: TimelineEvent = {
      id: targetId,
      timestamp: now(),
      event: "callback",
      from: "user",
      content: {
        type: "cb",
        data: cq.data,
        qid: cq.id,
        target: targetId,
      },
      _update: update,
    };
    // Don't call pushEvent — that would overwrite the bot message's CURRENT
    // slot in the index, breaking append_text and get_message on that message.
    // Callbacks are indexed by their own position in the queue, not by target.
    _timeline.push(evt);
    evictTimeline();

    // Fire one-shot auto-lock hook (registered by send_choice). Remove before
    // calling to prevent re-entry; errors are non-fatal.
    const hook = _callbackHooks.get(targetId);
    if (hook) {
      const ownerSid = _callbackHookOwners.get(targetId) ?? 0;
      _callbackHooks.delete(targetId);
      _callbackHookOwners.delete(targetId);
      try {
        if (ownerSid > 0) {
          runInSessionContext(ownerSid, () => { hook(evt); });
        } else {
          hook(evt);
        }
      } catch { /* non-fatal */ }
    }

    if (sessionQueueCount() === 0) _queue.enqueue({ event: evt });
    routeToSession(evt);
    return true;
  }

  // --- Reaction ---
  if (update.message_reaction) {
    const mr = update.message_reaction;
    const added = mr.new_reaction
      .filter((r) => r.type === "emoji")
      .map((r) => (r as { emoji: string }).emoji);
    const removed = mr.old_reaction
      .filter((r) => r.type === "emoji")
      .map((r) => (r as { emoji: string }).emoji);
    dlog("route", `inbound reaction id=${mr.message_id}`, { added, removed });
    const evt: TimelineEvent = {
      id: mr.message_id,
      timestamp: now(),
      event: "reaction",
      from: "user",
      content: {
        type: "reaction",
        target: mr.message_id,
        added,
        removed,
      },
      _update: update,
    };
    _timeline.push(evt);
    evictTimeline();
    // Reactions don't overwrite the message index — they reference it
    if (sessionQueueCount() === 0) _queue.enqueue({ event: evt });
    routeToSession(evt);
    return true;
  }

  // --- Regular message ---
  if (update.message) {
    const msg = update.message;
    // Dedup: skip if this message_id is already in the index (restart re-delivery)
    if (_index.has(msg.message_id)) {
      dlog("route", `inbound dedup skip id=${msg.message_id}`);
      return true;
    }
    const content = buildMessageContent(msg, transcribedText);
    if (msg.reply_to_message) {
      content.reply_to = msg.reply_to_message.message_id;
    }
    dlog("route", `inbound msg id=${msg.message_id}`, { type: content.type, reply_to: content.reply_to });
    const evt: TimelineEvent = {
      id: msg.message_id,
      timestamp: now(),
      event: "message",
      from: "user",
      content,
      _update: update,
    };
    pushEvent(evt);
    if (sessionQueueCount() === 0) _queue.enqueue({ event: evt });
    routeToSession(evt);

    // Fire one-shot message hooks for any afterId < this message's id.
    // Non-consuming: the event stays queued for dequeue.
    for (const [afterId, hook] of _messageHooks) {
      if (msg.message_id > afterId) {
        _messageHooks.delete(afterId);
        try { hook(); } catch { /* non-fatal */ }
      }
    }

    return true;
  }

  // Unrecognized update type — ignore
  return false;
}

/** Extract content fields from an inbound message. */
function buildMessageContent(
  msg: NonNullable<Update["message"]>,
  transcribedText?: string,
): EventContent {
  if (msg.text) {
    // Check for slash commands
    if (msg.text.startsWith("/")) {
      const parts = msg.text.split(/\s+/);
      const command = parts[0].slice(1).split("@")[0];
      const args = parts.slice(1).join(" ") || undefined;
      return { type: "command", text: command, data: args };
    }
    return { type: "text", text: msg.text };
  }
  if (msg.voice)
    return { type: "voice", text: transcribedText, file_id: msg.voice.file_id };
  if (msg.document)
    return {
      type: "doc",
      name: msg.document.file_name,
      mime: msg.document.mime_type,
      caption: msg.caption,
      file_id: msg.document.file_id,
    };
  if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    return { type: "photo", caption: msg.caption, file_id: largest.file_id };
  }
  if (msg.video)
    return {
      type: "video",
      name: msg.video.file_name,
      mime: msg.video.mime_type,
      caption: msg.caption,
      file_id: msg.video.file_id,
    };
  if (msg.audio)
    return {
      type: "audio",
      name: msg.audio.title ?? msg.audio.file_name,
      mime: msg.audio.mime_type,
      caption: msg.caption,
      file_id: msg.audio.file_id,
    };
  if (msg.sticker)
    return { type: "sticker", emoji: msg.sticker.emoji };
  if (msg.animation)
    return { type: "animation", name: msg.animation.file_name, file_id: msg.animation.file_id };
  if (msg.contact)
    return { type: "contact", text: msg.contact.phone_number };
  if (msg.location)
    return {
      type: "location",
      text: `${msg.location.latitude},${msg.location.longitude}`,
    };
  return { type: "unknown" };
}

// ---------------------------------------------------------------------------
// Outbound bot messages (indexed + logged, NOT enqueued)
// ---------------------------------------------------------------------------

/**
 * Records a bot-sent message in the timeline + index.
 * NOT enqueued — the agent already has the message_id from the send response.
 */
export function recordOutgoing(
  messageId: number,
  contentType: string,
  text?: string,
  caption?: string,
  fileId?: string,
  sid?: number,
): void {
  recordBotMessage({
    message_id: messageId,
    content_type: contentType,
    text,
    caption,
  });
  const content: EventContent = { type: contentType };
  if (text !== undefined) content.text = text;
  if (caption !== undefined) content.caption = caption;
  if (fileId !== undefined) content.file_id = fileId;
  const activeSid = sid ?? getCallerSid();
  const evt: TimelineEvent = {
    id: messageId,
    timestamp: now(),
    event: "sent",
    from: "bot",
    content,
    ...(activeSid > 0 && { sid: activeSid }),
  };
  dlog("route", `outbound id=${messageId} type=${contentType}`, { sid: activeSid });
  pushEvent(evt);
  trackMessageOwner(messageId, activeSid);
}

/**
 * Records a bot-message edit with version history.
 * Current → next version slot, new content → CURRENT.
 */
export function recordOutgoingEdit(
  messageId: number,
  contentType: string,
  text?: string,
  sid?: number,
): void {
  recordBotMessage({
    message_id: messageId,
    content_type: contentType,
    text,
  });
  const versions = _index.get(messageId);
  if (!versions) {
    // Message was evicted — record as edit (not "sent") to preserve intent
    const activeSid = sid ?? getCallerSid();
    const evt: TimelineEvent = {
      id: messageId,
      timestamp: now(),
      event: "edit",
      from: "bot",
      content: { type: contentType, text },
      ...(activeSid > 0 && { sid: activeSid }),
    };
    pushEvent(evt);
    return;
  }

  const current = versions.get(CURRENT);
  if (current) {
    // Move current → version 0 (or next available)
    const nextVersion = versions.size - 1;
    versions.set(nextVersion, current);
  }

  const activeSidEdit = sid ?? getCallerSid();
  const evt: TimelineEvent = {
    id: messageId,
    timestamp: now(),
    event: "edit",
    from: "bot",
    content: { type: contentType, text },
    ...(activeSidEdit > 0 && { sid: activeSidEdit }),
  };
  _timeline.push(evt);
  evictTimeline();
  versions.set(CURRENT, evt);
}

/**
 * Records a bot reaction in the timeline (not indexed, not enqueued).
 */
export function recordBotReaction(
  targetMessageId: number,
  emoji: string,
): void {
  const evt: TimelineEvent = {
    id: targetMessageId,
    timestamp: now(),
    event: "reaction",
    from: "bot",
    content: { type: "reaction", target: targetMessageId, added: [emoji] },
  };
  _timeline.push(evt);
  evictTimeline();
  if (emoji) {
    _botReactionIndex.set(targetMessageId, emoji);
  } else {
    _botReactionIndex.delete(targetMessageId);
  }
}

/**
 * Returns the most recent bot reaction emoji recorded for the given message,
 * or null if no reaction has been set (or it was removed).
 */
export function getBotReaction(messageId: number): string | null {
  return _botReactionIndex.get(messageId) ?? null;
}

/**
 * Returns true if the implicit 👌 base reaction has already been placed on this
 * (chatId, messageId) pair. Used to enforce idempotency.
 */
export function hasBaseReaction(chatId: number, messageId: number): boolean {
  return _baseReactionMessages.has(`${chatId}:${messageId}`);
}

/**
 * Marks a (chatId, messageId) as having received the implicit 👌 base reaction.
 */
export function markBaseReaction(chatId: number, messageId: number): void {
  _baseReactionMessages.add(`${chatId}:${messageId}`);
}

// ---------------------------------------------------------------------------
// Dequeue — consumption by the agent (delegates to TemporalQueue)
// ---------------------------------------------------------------------------

/**
 * Returns the next ready item in temporal order.
 * Skips voice messages that are still waiting for transcription.
 */
export function dequeue(): TimelineEvent | undefined {
  return _queue.dequeue()?.event;
}

/**
 * Temporal batch dequeue: collects events in arrival order up to and
 * including the first heavyweight event (text/voice). Returns empty
 * array if nothing available or if a voice delimiter is still pending.
 */
export function dequeueBatch(): TimelineEvent[] {
  return _queue.dequeueBatch().map((item) => item.event);
}

/**
 * Finds and removes the first queued item matching the predicate.
 */
export function dequeueMatch<T>(
  predicate: (event: TimelineEvent) => T | undefined,
): T | undefined {
  return _queue.dequeueMatch((item) => predicate(item.event));
}

/** Number of unconsumed items across both lanes. */
export function pendingCount(): number {
  return _queue.pendingCount();
}

/**
 * Returns a promise that resolves when a new item is enqueued.
 * Used by dequeue to wait when the queue is empty.
 */
export function waitForEnqueue(): Promise<void> {
  return _queue.waitForEnqueue();
}

/** True if at least one dequeue call is blocked waiting for data. */
export function hasPendingWaiters(): boolean {
  return _queue.hasPendingWaiters();
}

// ---------------------------------------------------------------------------
// Random-access lookup
// ---------------------------------------------------------------------------

/**
 * Look up a message by ID and optional version.
 * - version = -1 (default) → current/latest
 * - version = 0 → original (before first edit)
 * - version = 1, 2, … → specific edit
 *
 * Returns undefined if the message_id is not in the store or the
 * requested version doesn't exist.
 */
export function getMessage(
  messageId: number,
  version: number = CURRENT,
): TimelineEvent | undefined {
  const versions = _index.get(messageId);
  if (!versions) return undefined;
  return versions.get(version);
}

/**
 * Returns all version keys for a message_id, sorted ascending.
 * Useful for get_message to report how many versions exist.
 */
export function getVersions(messageId: number): number[] {
  const versions = _index.get(messageId);
  if (!versions) return [];
  return Array.from(versions.keys()).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Timeline dump — full event log for dump_session_record
// ---------------------------------------------------------------------------

/**
 * Returns the full timeline as a JSON-serializable array.
 * Each event includes id, timestamp, event, from, content — in that order.
 * The _update field is stripped (raw Telegram data, too verbose for dump).
 */
export function dumpTimeline(): Array<Omit<TimelineEvent, "_update">> {
  return _timeline.map(({ _update: _, ...rest }) => rest);
}

/**
 * Returns timeline events from `cursor` onward (0-based index into
 * the internal array) plus the new cursor for the next call.
 * Used by auto-dump to capture only events since the last dump.
 * If the timeline was evicted past the cursor, returns all current events.
 */
export function dumpTimelineSince(cursor: number): {
  events: Array<Omit<TimelineEvent, "_update">>;
  nextCursor: number;
} {
  const start = Math.max(0, Math.min(cursor, _timeline.length));
  const events = _timeline.slice(start).map(({ _update: _, ...rest }) => rest);
  return { events, nextCursor: _timeline.length };
}

/** Number of events currently in the timeline. */
export function timelineSize(): number {
  return _timeline.length;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** Number of unique message_ids currently in the index. */
export function storeSize(): number {
  return _index.size;
}

/**
 * Returns the highest message_id seen from any source, or 0 if empty.
 * Used by the animation system for position detection (edit vs delete).
 */
export function getHighestMessageId(): number {
  return _highestMessageId;
}

/**
 * Bump the highwater mark for a message_id that bypasses the store
 * (e.g. animation placeholders sent via bypassProxy).
 */
export function trackMessageId(messageId: number): void {
  if (messageId > _highestMessageId) _highestMessageId = messageId;
}



// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

/** Resets all store state. For tests only. */
export function resetStoreForTest(): void {
  _timeline = [];
  _index = new Map();
  _insertionOrder = [];
  _highestMessageId = 0;
  _queue.clear();
  _callbackHooks.clear();
  _callbackHookOwners.clear();
  _messageHooks.clear();
  _botReactionIndex.clear();
  _baseReactionMessages.clear();
  _onEventCallback = null;
  _onLocalLogCallback = null;
}

/** Register a one-shot auto-lock hook for a send_choice message. */
export function registerCallbackHook(messageId: number, fn: CallbackHookFn, ownerSid?: number): void {
  _callbackHooks.set(messageId, fn);
  if (ownerSid !== undefined && ownerSid > 0) {
    _callbackHookOwners.set(messageId, ownerSid);
  }
}

/** Remove a previously registered callback hook (e.g. on send_choice cleanup). */
export function clearCallbackHook(messageId: number): void {
  _callbackHooks.delete(messageId);
  _callbackHookOwners.delete(messageId);
}

/**
 * Replace all callback hooks owned by a session with a "Session closed" responder.
 * Called during session teardown so late button presses get a graceful ack.
 * Returns the message IDs that were replaced.
 */
export function replaceSessionCallbackHooks(
  sid: number,
  replacement: CallbackHookFn,
): number[] {
  const replaced: number[] = [];
  for (const [msgId, ownerSid] of _callbackHookOwners) {
    if (ownerSid === sid) {
      _callbackHooks.set(msgId, replacement);
      _callbackHookOwners.delete(msgId);
      replaced.push(msgId);
    }
  }
  return replaced;
}

/** Register a one-shot hook that fires on the first message with id > afterId. */
export function registerMessageHook(afterId: number, fn: MessageHookFn): void {
  _messageHooks.set(afterId, fn);
}

/** Remove a previously registered message hook. */
export function clearMessageHook(afterId: number): void {
  _messageHooks.delete(afterId);
}

/**
 * Patches the transcribed text onto an already-recorded voice event.
 * Called by the poller after transcription completes (two-phase recording).
 * The event object is mutated in-place — the queue still holds the same
 * reference, so blocking waiters will see the text on their next scan.
 * Notifies waiters so they unblock and consume the now-complete event.
 */
export function patchVoiceText(messageId: number, text: string): void {
  const versions = _index.get(messageId);
  if (!versions) return;
  const current = versions.get(CURRENT);
  if (!current || current.content.type !== "voice") return;
  dlog("route", `voice patch id=${messageId}`, { len: text.length });
  current.content.text = text;
  _queue.notifyWaiters();
  notifySessionWaiters();
}
