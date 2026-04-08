/**
 * Per-session message queues and inbound routing.
 *
 * Each session gets its own TemporalQueue<TimelineEvent>. When an inbound
 * update arrives, the router decides which session(s) receive it:
 *
 *   - Reply-to / callback / reaction → owning session (targeted)
 *   - Ambiguous (no reply context) → governor session (if set), else broadcast
 *
 * The global queue in message-store remains the "session 0" fallback and
 * is always populated (backward compat). Session queues are additive —
 * they receive copies of the same event references.
 */

import { TemporalQueue } from "./temporal-queue.js";
import type { TimelineEvent } from "./message-store.js";
import { getMessage, CURRENT } from "./message-store.js";
import { getGovernorSid } from "./routing-mode.js";
import { dlog } from "./debug-log.js";
import type { ReminderEvent } from "./reminder-state.js";

// ---------------------------------------------------------------------------
// Voice-ready predicate (shared with message-store's queue)
// ---------------------------------------------------------------------------

function isEventReady(event: TimelineEvent): boolean {
  const c = event.content;
  return !(c.type === "voice" && c.text === undefined);
}

/**
 * Heavyweight events are temporal batch delimiters — user text and voice
 * messages. Reactions, callbacks, files, DMs, and service messages are
 * lightweight and collected ahead of the delimiter.
 */
function isHeavyweightEvent(event: TimelineEvent): boolean {
  return event.event === "message" &&
    (event.content.type === "text" || event.content.type === "voice");
}

function getEventId(event: TimelineEvent): number {
  return event.id;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** sid → per-session queue */
const _queues = new Map<number, TemporalQueue<TimelineEvent>>();

/** message_id → owning sid (tracks which session sent each bot message) */
const _messageOwnership = new Map<number, number>();



// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------

/** Create a queue for a new session. Returns false if already exists. */
export function createSessionQueue(sid: number): boolean {
  if (_queues.has(sid)) return false;
  _queues.set(sid, new TemporalQueue<TimelineEvent>({
    isHeavyweight: isHeavyweightEvent,
    isReady: isEventReady,
    getId: getEventId,
  }));
  dlog("queue", `created queue for sid=${sid} total=${_queues.size}`);
  return true;
}

/** Remove a session's queue and clean up ownership entries. */
export function removeSessionQueue(sid: number): boolean {
  const removed = _queues.delete(sid);
  if (removed) {
    dlog("queue", `removed queue for sid=${sid} remaining=${_queues.size}`);
    for (const [msgId, owner] of _messageOwnership) {
      if (owner === sid) _messageOwnership.delete(msgId);
    }
  }
  return removed;
}


/**
 * Drain all pending items from a session's queue without removing the queue.
 * Returns events from both lanes (response lane first), skipping not-ready items.
 * Used during teardown to reroute orphaned messages.
 */
export function drainQueue(sid: number): TimelineEvent[] {
  const q = _queues.get(sid);
  if (!q) return [];
  const items: TimelineEvent[] = [];
  let item: TimelineEvent | undefined;
  while ((item = q.dequeue()) !== undefined) {
    items.push(item);
  }
  dlog("queue", `drained sid=${sid} orphaned=${items.length}`);
  return items;
}

/** Get a session's queue (or undefined if no such session). */
export function getSessionQueue(sid: number): TemporalQueue<TimelineEvent> | undefined {
  return _queues.get(sid);
}

/**
 * Non-destructive peek: returns pending item counts by content type for a session.
 * Returns undefined when no queue exists for the given sid.
 */
export function peekSessionCategories(sid: number): Record<string, number> | undefined {
  return _queues.get(sid)?.peekCategories((evt) => evt.content.type);
}

/** Number of active session queues. */
export function sessionQueueCount(): number {
  return _queues.size;
}

// ---------------------------------------------------------------------------
// Message ownership (outbound tracking)
// ---------------------------------------------------------------------------

/**
 * Record that a bot message was sent by a specific session.
 * Called by outbound recording so inbound replies can route back.
 */
export function trackMessageOwner(messageId: number, sid: number): void {
  if (sid > 0) _messageOwnership.set(messageId, sid);
}

/** Look up which session sent a given bot message. Returns 0 if unknown. */
export function getMessageOwner(messageId: number): number {
  return _messageOwnership.get(messageId) ?? 0;
}

// ---------------------------------------------------------------------------
// Inbound routing
// ---------------------------------------------------------------------------

/**
 * Route an inbound event to the appropriate session queue(s).
 *
 * Routing rules:
 *   1. Targeted (reply-to, callback, reaction on owned message) → owner only
 *   2. Ambiguous (no reply context) → governor session (if set)
 *   3. Fallback → broadcast to all sessions
 *
 * The global queue in message-store is NOT touched here — it's
 * populated by recordInbound as before. This is additive.
 */
export function routeToSession(event: TimelineEvent): void {
  if (_queues.size === 0) return;

  const targetSid = resolveTargetSession(event);

  if (targetSid > 0) {
    // Targeted: deliver only to the owning session
    dlog("route", `targeted event=${event.id} → sid=${targetSid}`, { type: event.content.type });
    enqueueToSession(targetSid, event);
    return;
  }

  // Ambiguous: deliver to governor if set
  const gSid = getGovernorSid();
  if (gSid > 0 && _queues.has(gSid)) {
    dlog("route", `governor event=${event.id} → sid=${gSid}`, { type: event.content.type });
    enqueueToSession(gSid, event);
    return;
  }

  // Fallback: broadcast to all sessions
  dlog("route", `broadcast event=${event.id} → ${_queues.size} sessions`);
  for (const q of _queues.values()) {
    q.enqueue(event);
  }
}

/**
 * Determine which session an inbound event is targeted at.
 * Returns the owning sid, or 0 for ambiguous.
 */
function resolveTargetSession(event: TimelineEvent): number {
  // Reply-to: user replied to a bot message owned by a session
  if (event.content.reply_to) {
    return getMessageOwner(event.content.reply_to);
  }

  // Callback/reaction: targeted at the message the button/reaction is on
  if (event.content.target) {
    return getMessageOwner(event.content.target);
  }

  return 0;
}

/** Enqueue to a single session by SID. No-op if queue is missing. */
function enqueueToSession(
  sid: number,
  event: TimelineEvent,
): void {
  const q = _queues.get(sid);
  if (!q) return;
  q.enqueue(event);
}

// ---------------------------------------------------------------------------
// Cross-session outbound forwarding
// ---------------------------------------------------------------------------

/**
 * Forward an outbound bot event to the governor session.
 * The governor receives all outbound events automatically — no opt-in needed.
 * The sender is always excluded (even if sender is the governor).
 */
export function broadcastOutbound(event: TimelineEvent, senderSid: number): void {
  const govSid = getGovernorSid();
  if (govSid <= 0 || govSid === senderSid) return;
  const q = _queues.get(govSid);
  if (q) q.enqueue(event);
}

// ---------------------------------------------------------------------------
// Voice patch forwarding
// ---------------------------------------------------------------------------

/**
 * Notify session queue waiters after a voice event is patched with text.
 * Called by patchVoiceText in message-store after mutating the event.
 */
export function notifySessionWaiters(): void {
  for (const q of _queues.values()) {
    q.notifyWaiters();
  }
}

/**
 * Returns true if any session queue has a pending waiter (agent blocked in
 * dequeue). Used by the poller to decide whether to skip setting 😴 —
 * if a session agent is waiting, it will dequeue and set 🫡 itself.
 */
export function hasAnySessionWaiter(): boolean {
  for (const q of _queues.values()) {
    if (q.hasPendingWaiters()) return true;
  }
  return false;
}

/**
 * Returns true if the specific session queue that holds this message has an
 * active waiter (agent blocked in dequeue). Unlike `hasAnySessionWaiter`,
 * this checks only the queue that actually contains the voice message — so a
 * governor waiter on a different session does NOT suppress 😴 for a message
 * routed to a worker with no active waiter.
 */
export function hasSessionWaiterForMessage(messageId: number): boolean {
  for (const q of _queues.values()) {
    if (q.hasItem(messageId) && q.hasPendingWaiters()) return true;
  }
  return false;
}

/**
 * Returns true if any session queue has already consumed the given message ID.
 * Used by the poller as a secondary guard against setting 😴 on an already-
 * dequeued message (e.g. agent consumed the message before transcription
 * completed from a previous dequeue cycle).
 */
export function isSessionMessageConsumed(messageId: number): boolean {
  for (const q of _queues.values()) {
    if (q.isConsumed(messageId)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Direct message delivery (inter-session, internal only)
// ---------------------------------------------------------------------------

/** Auto-incrementing ID for synthetic DM events. Negative to avoid collisions. */
let _nextDmId = -1;
let _nextServiceId = -100_000;

/**
 * Deliver a direct message from one session to another.
 * Injects a synthetic TimelineEvent into the target session's queue.
 * Returns false if the target queue does not exist.
 */
export function deliverDirectMessage(
  senderSid: number,
  targetSid: number,
  text: string,
): boolean {
  const q = _queues.get(targetSid);
  if (!q) return false;

  const event: TimelineEvent = {
    id: _nextDmId--,
    timestamp: new Date().toISOString(),
    event: "direct_message",
    from: "bot",
    content: { type: "direct_message", text },
    sid: senderSid,
  };

  q.enqueue(event);
  dlog("dm", `delivered DM from sid=${senderSid} → sid=${targetSid}`, { eventId: event.id });
  return true;
}

/**
 * Inject a server-generated service message into a session queue.
 * Returned events have `from: "system"` and `event: "service_message"`.
 * Returns false if the target queue does not exist.
 */
export function deliverServiceMessage(
  targetSid: number,
  text: string,
  eventType: string,
  details?: Record<string, unknown>,
): boolean {
  const q = _queues.get(targetSid);
  if (!q) return false;

  const event: TimelineEvent = {
    id: _nextServiceId--,
    timestamp: new Date().toISOString(),
    event: "service_message",
    from: "system",
    content: { type: "service", text, event_type: eventType, ...(details && { details }) },
    sid: 0,
  };

  q.enqueue(event);
  dlog("service", `service message → sid=${targetSid}`, { eventType, eventId: event.id });
  return true;
}

/**
 * Inject a reminder event into a session queue.
 * Used by session_start to deliver startup reminders.
 * Returns false if the target queue does not exist.
 */
export function deliverReminderEvent(
  targetSid: number,
  reminderEvent: ReminderEvent,
): boolean {
  const q = _queues.get(targetSid);
  if (!q) return false;

  const src = reminderEvent.content;
  const event: TimelineEvent = {
    id: reminderEvent.id,
    timestamp: new Date().toISOString(),
    event: "reminder",
    from: "system",
    content: {
      type: src.type,
      text: src.text,
    },
    sid: 0,
  };
  // Preserve reminder-specific fields that consumers depend on, without unsafe cast.
  // EventContent allows extra properties at runtime since it's a structural interface.
  Object.assign(event.content, {
    reminder_id: src.reminder_id,
    recurring: src.recurring,
    trigger: src.trigger,
  });

  q.enqueue(event);
  dlog("service", `startup reminder → sid=${targetSid}`, { reminderId: src.reminder_id });
  return true;
}

/**
 * Route a message to a specific target session (governor delegation).
 * Injects `routed_by: routerSid` into the event copy so the recipient can
 * verify the routing came from the server, not the original sender.
 * Returns true if delivered, false if message or target queue not found.
 */
export function routeMessage(messageId: number, targetSid: number, routerSid: number): boolean {
  const event = getMessage(messageId, CURRENT);
  if (!event) return false;

  const q = _queues.get(targetSid);
  if (!q) return false;

  // Shallow-copy the event and inject the server-stamped routing envelope.
  const routed: TimelineEvent = {
    ...event,
    content: { ...event.content, routed_by: routerSid },
  };
  q.enqueue(routed);
  dlog("route", `governor delegated msg=${messageId} → sid=${targetSid}`, { routerSid });
  return true;
}

/**
 * Deliver a `voice_transcription_failed` service message to the session that
 * received the voice message. Mirrors routeToSession's ambiguous routing:
 * governor first, then broadcast to all sessions. No-op in single-session
 * mode (no session queues exist).
 */
export function deliverVoiceTranscriptionFailed(
  messageId: number,
  reason: string,
  details: string,
): void {
  if (_queues.size === 0) return;

  const text =
    `Voice message ${messageId} could not be transcribed (${reason}). ` +
    `Ask the operator to resend if needed.`;
  const svcDetails = { message_id: messageId, reason, details };

  const gSid = getGovernorSid();
  if (gSid > 0 && _queues.has(gSid)) {
    deliverServiceMessage(gSid, text, "voice_transcription_failed", svcDetails);
    return;
  }

  // No governor — broadcast to all active sessions
  for (const sid of _queues.keys()) {
    deliverServiceMessage(sid, text, "voice_transcription_failed", svcDetails);
  }
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetSessionQueuesForTest(): void {
  _queues.clear();
  _messageOwnership.clear();
  _nextDmId = -1;
  _nextServiceId = -100_000;
}
