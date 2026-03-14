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

// ---------------------------------------------------------------------------
// Simple generic queue (replaces @tsdotnet/queue)
// ---------------------------------------------------------------------------

class SimpleQueue<T> {
  private _items: T[] = [];

  enqueue(item: T, maxSize?: number): void {
    if (maxSize && this._items.length >= maxSize) this._items.shift();
    this._items.push(item);
  }

  dequeue(): T | undefined {
    return this._items.shift();
  }

  /** Destructive drain — empties the queue, returns all items. */
  dump(): T[] {
    const items = this._items;
    this._items = [];
    return items;
  }

  clear(): void {
    this._items = [];
  }

  get count(): number {
    return this._items.length;
  }
}

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
  /** Who originated: "user" or "bot". */
  from: "user" | "bot";
  /** Event-specific payload. */
  content: EventContent;
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

/** Maximum items per queue lane — bounds memory for slow consumers. */
const MAX_QUEUE_SIZE = 5000;

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
let _botReactionIndex = new Map<number, string>();

/** Two-lane queue — response lane items drain before message lane. */
const _responseLane = new SimpleQueue<QueueItem>();
const _messageLane = new SimpleQueue<QueueItem>();

/** Message IDs that have been dequeued by the agent. Used by poller to skip 😴 on already-consumed voice messages. */
const _consumedMessageIds = new Set<number>();

/** Returns true if the given message_id has already been dequeued. */
export function isMessageConsumed(messageId: number): boolean {
  return _consumedMessageIds.has(messageId);
}

/**
 * Listeners waiting for the next enqueue. Resolved when a new item is
 * pushed to either lane. Used by dequeue_update to wait on empty queue.
 */
let _waiters: Array<() => void> = [];

/**
 * One-shot hooks registered by send_choice for auto-lock. Fired on the first
 * callback_query for the target messageId, then removed. The event is still
 * enqueued normally so dequeue_update will see it.
 */
type CallbackHookFn = (event: TimelineEvent) => void;
const _callbackHooks = new Map<number, CallbackHookFn>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

/** Evict oldest timeline events when over capacity. */
function evictTimeline(): void {
  while (_timeline.length > MAX_TIMELINE) {
    _timeline.shift();
  }
}

/** Evict the oldest message_id from the index when over capacity. */
function evictIndex(): void {
  while (_insertionOrder.length > MAX_MESSAGES) {
    const oldest = _insertionOrder.shift();
    if (oldest !== undefined) _index.delete(oldest);
  }
}

/** Notify any pending dequeue waiters that new data is available. */
function notifyWaiters(): void {
  const batch = _waiters;
  _waiters = [];
  for (const resolve of batch) resolve();
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
}

// ---------------------------------------------------------------------------
// Inbound updates (from Telegram poller)
// ---------------------------------------------------------------------------

/**
 * Records an inbound update and enqueues it for dequeue_update.
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
      _callbackHooks.delete(targetId);
      try { hook(evt); } catch { /* non-fatal */ }
    }

    _responseLane.enqueue({ event: evt }, MAX_QUEUE_SIZE);
    notifyWaiters();
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
    _responseLane.enqueue({ event: evt }, MAX_QUEUE_SIZE);
    notifyWaiters();
    return true;
  }

  // --- Regular message ---
  if (update.message) {
    const msg = update.message;
    // Dedup: skip if this message_id is already in the index (restart re-delivery)
    if (_index.has(msg.message_id)) {
      return true;
    }
    const content = buildMessageContent(msg, transcribedText);
    if (msg.reply_to_message) {
      content.reply_to = msg.reply_to_message.message_id;
    }
    const evt: TimelineEvent = {
      id: msg.message_id,
      timestamp: now(),
      event: "message",
      from: "user",
      content,
      _update: update,
    };
    pushEvent(evt);
    _messageLane.enqueue({ event: evt }, MAX_QUEUE_SIZE);
    notifyWaiters();

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
): void {
  recordBotMessage({
    message_id: messageId,
    content_type: contentType,
    text,
    caption,
  });
  const evt: TimelineEvent = {
    id: messageId,
    timestamp: now(),
    event: "sent",
    from: "bot",
    content: { type: contentType, text, caption },
  };
  pushEvent(evt);
}

/**
 * Records a bot-message edit with version history.
 * Current → next version slot, new content → CURRENT.
 */
export function recordOutgoingEdit(
  messageId: number,
  contentType: string,
  text?: string,
): void {
  recordBotMessage({
    message_id: messageId,
    content_type: contentType,
    text,
  });
  const versions = _index.get(messageId);
  if (!versions) {
    // Message was evicted — record as edit (not "sent") to preserve intent
    const evt: TimelineEvent = {
      id: messageId,
      timestamp: now(),
      event: "edit",
      from: "bot",
      content: { type: contentType, text },
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

  const evt: TimelineEvent = {
    id: messageId,
    timestamp: now(),
    event: "edit",
    from: "bot",
    content: { type: contentType, text },
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

// ---------------------------------------------------------------------------
// Dequeue — consumption by the agent
// ---------------------------------------------------------------------------

/**
 * Returns the next available queue item, response lane first.
 * Skips voice messages that are still waiting for transcription (text is
 * undefined) — they stay queued until patchVoiceText fills them in.
 * Returns undefined if both lanes are empty or only contain pending voice.
 */
export function dequeue(): TimelineEvent | undefined {
  const item = _dequeueReady(_responseLane) ?? _dequeueReady(_messageLane);
  if (item?.event.id !== undefined) _consumedMessageIds.add(item.event.id);
  return item?.event;
}

/** Dequeue the first item that is NOT a voice-pending-transcription. */
function _dequeueReady(lane: SimpleQueue<QueueItem>): QueueItem | undefined {
  const items = lane.dump();
  let found: QueueItem | undefined;
  for (const item of items) {
    if (!found && _isReady(item)) {
      found = item;
      continue; // don't re-enqueue the consumed item
    }
    lane.enqueue(item);
  }
  return found;
}

/** A queue item is ready unless it's a voice message still waiting for text. */
function _isReady(item: QueueItem): boolean {
  const c = item.event.content;
  return !(c.type === "voice" && c.text === undefined);
}

/**
 * Finds and removes the first queued item matching the predicate.
 * Checks response lane first, then message lane.
 * Used by compound tools (ask, choose, send_confirmation) to consume
 * a specific callback/message from the queue.
 */
export function dequeueMatch<T>(
  predicate: (event: TimelineEvent) => T | undefined,
): T | undefined {
  return scanAndRemove(_responseLane, predicate)
    ?? scanAndRemove(_messageLane, predicate);
}

/** Drain a lane, extract the first match, re-enqueue the rest. */
function scanAndRemove<T>(
  lane: SimpleQueue<QueueItem>,
  predicate: (event: TimelineEvent) => T | undefined,
): T | undefined {
  const items = lane.dump();
  let found: T | undefined;
  let consumedEventId: number | undefined;
  for (const item of items) {
    if (found === undefined) {
      const result = predicate(item.event);
      if (result !== undefined) {
        found = result;
        consumedEventId = item.event.id;
        continue; // don't re-enqueue the matched item
      }
    }
    lane.enqueue(item);
  }
  if (consumedEventId !== undefined) _consumedMessageIds.add(consumedEventId);
  // Wake waiters when a match was found — even if the lane is now empty (items
  // may exist in the other lane). The churn-loop concern only applies to *misses*
  // (found === undefined), which still skip the notify.
  if (found !== undefined) notifyWaiters();
  return found;
}

/** Number of unconsumed items across both lanes. */
export function pendingCount(): number {
  return _responseLane.count + _messageLane.count;
}

/**
 * Returns a promise that resolves when a new item is enqueued.
 * Used by dequeue_update to wait when the queue is empty.
 */
export function waitForEnqueue(): Promise<void> {
  return new Promise((resolve) => {
    _waiters.push(resolve);
  });
}

/** True if at least one dequeue_update call is blocked waiting for data. */
export function hasPendingWaiters(): boolean {
  return _waiters.length > 0;
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
  _responseLane.clear();
  _messageLane.clear();
  _waiters = [];
  _callbackHooks.clear();
  _botReactionIndex.clear();
  _consumedMessageIds.clear();
}

/** Register a one-shot auto-lock hook for a send_choice message. */
export function registerCallbackHook(messageId: number, fn: CallbackHookFn): void {
  _callbackHooks.set(messageId, fn);
}

/** Remove a previously registered callback hook (e.g. on send_choice cleanup). */
export function clearCallbackHook(messageId: number): void {
  _callbackHooks.delete(messageId);
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
  current.content.text = text;
  notifyWaiters();
}
