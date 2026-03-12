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

  enqueue(item: T): void {
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

/** Two-lane queue — response lane items drain before message lane. */
const _responseLane = new SimpleQueue<QueueItem>();
const _messageLane = new SimpleQueue<QueueItem>();

/**
 * Listeners waiting for the next enqueue. Resolved when a new item is
 * pushed to either lane. Used by dequeue_update to wait on empty queue.
 */
let _waiters: Array<() => void> = [];

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
export function recordInbound(update: Update, transcribedText?: string): void {
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
    return;
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
    _responseLane.enqueue({ event: evt });
    notifyWaiters();
    return;
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
    _responseLane.enqueue({ event: evt });
    notifyWaiters();
    return;
  }

  // --- Regular message ---
  if (update.message) {
    const msg = update.message;
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
    _messageLane.enqueue({ event: evt });
    notifyWaiters();
    return;
  }

  // Unrecognized update type — ignore
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
    return { type: "voice", text: transcribedText };
  if (msg.document)
    return {
      type: "doc",
      name: msg.document.file_name,
      mime: msg.document.mime_type,
      caption: msg.caption,
    };
  if (msg.photo)
    return { type: "photo", caption: msg.caption };
  if (msg.video)
    return {
      type: "video",
      name: msg.video.file_name,
      mime: msg.video.mime_type,
      caption: msg.caption,
    };
  if (msg.audio)
    return {
      type: "audio",
      name: msg.audio.title ?? msg.audio.file_name,
      mime: msg.audio.mime_type,
      caption: msg.caption,
    };
  if (msg.sticker)
    return { type: "sticker", emoji: msg.sticker.emoji };
  if (msg.animation)
    return { type: "animation", name: msg.animation.file_name };
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
    // Message was evicted — just record as new
    recordOutgoing(messageId, contentType, text);
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
}

// ---------------------------------------------------------------------------
// Dequeue — consumption by the agent
// ---------------------------------------------------------------------------

/**
 * Returns the next available queue item, response lane first.
 * Returns undefined if both lanes are empty.
 */
export function dequeue(): TimelineEvent | undefined {
  return (_responseLane.dequeue() ?? _messageLane.dequeue())?.event;
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
  for (const item of items) {
    if (found === undefined) {
      const result = predicate(item.event);
      if (result !== undefined) {
        found = result;
        continue; // don't re-enqueue the matched item
      }
    }
    lane.enqueue(item);
  }
  // If non-matched items were re-enqueued, wake any waiters that registered
  // after the original notifyWaiters() was already consumed (prevents up to
  // timeout-length stall in ask/choose when an unrelated event was scanned).
  if (lane.count > 0) notifyWaiters();
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



// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

/** Resets all store state. For tests only. */
export function resetStoreForTest(): void {
  _timeline = [];
  _index = new Map();
  _insertionOrder = [];
  _responseLane.clear();
  _messageLane.clear();
  _waiters = [];
}
