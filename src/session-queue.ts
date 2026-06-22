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
import { recordLastSentAt, recordLastReceivedAt, popFireableEventReminders, buildReminderEvent, setReminderFireCallback } from "./reminder-state.js";
import { isDequeueActive } from "./tools/activity/file-state.js";
import { notifyChannelSubscriber } from "./channel.js";
import { notifySession } from "./tools/notify.js";
import { getSession } from "./session-manager.js";
import { recordNonToolEvent } from "./trace-log.js";

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

const OPERATOR_MESSAGE_TYPES = new Set([
  "text", "voice", "command", "photo", "doc", "video",
  "audio", "sticker", "animation", "contact", "location", "unknown",
]);

/**
 * Determine whether an inbound event qualifies for last_received tracking.
 * Returns qualifiesAll (for mode:"all") and qualifiesOperator (for mode:"operator").
 *
 * Exclusions per spec: service messages, reminder fires, reactions, ack/approve tickets.
 */
function qualifyInbound(event: TimelineEvent): { all: boolean; operator: boolean } {
  // Reminder fires are explicitly excluded (loop prevention)
  if (event.event === "reminder") return { all: false, operator: false };
  // Service messages and internal housekeeping are excluded
  if (event.event === "service_message") return { all: false, operator: false };
  if (event.event === "send_callback") return { all: false, operator: false };

  // Direct messages (inter-session DMs) qualify for "all" mode only
  if (event.event === "direct_message") return { all: true, operator: false };

  // Inbound operator messages
  if (event.event === "message" && event.from === "user") {
    const t = event.content.type;
    // Reactions and callbacks (ack/approve tickets) are excluded
    if (t === "reaction" || t === "callback") return { all: false, operator: false };
    if (OPERATOR_MESSAGE_TYPES.has(t)) return { all: true, operator: true };
  }

  return { all: false, operator: false };
}

/** Update last_received timestamps for a session based on a qualifying inbound event. */
function notifyLastReceived(sid: number, event: TimelineEvent): void {
  const { all, operator } = qualifyInbound(event);
  if (!all && !operator) return;
  const now = Date.now();
  if (all) recordLastReceivedAt(sid, "all", now);
  if (operator) recordLastReceivedAt(sid, "operator", now);
}

// If new operator-message types are added to buildMessageContent in message-store.ts, add them here too.
export function hasPendingUserContent(sid: number): boolean {
  const cats = peekSessionCategories(sid);
  if (!cats) return false;
  return [...OPERATOR_MESSAGE_TYPES].some(t => (cats[t] ?? 0) > 0);
}

/**
 * Returns true iff a call to /dequeue would drain at least one item from this
 * session's queue (i.e. dequeueBatch() would return a non-empty batch).
 *
 * dequeueBatch returns [] in exactly one case: the queue has a heavyweight item
 * (text/voice message) as its first heavyweight, and that item is NOT yet ready
 * (voice pending transcription). In all other cases — pure-lightweight queues
 * (direct_message, callback, send_callback, service_message, reminder, etc.) or
 * queues whose first heavyweight IS ready — the batch is non-empty.
 *
 * Use this for the connect-notify EC-1 path only. Keep hasPendingUserContent for
 * debounce/re-notify logic (those paths intentionally ignore lightweight-only queues).
 */
export function hasAnyPendingContent(sid: number): boolean {
  const q = _queues.get(sid);
  if (!q) return false;
  // A pending count of zero means nothing to drain.
  if (q.pendingCount() === 0) return false;
  // dequeueBatch returns [] only when the FIRST heavyweight is not ready.
  // peekFirst finds that item; if it is lightweight (or doesn't exist), the batch drains.
  const firstHeavy = q.peekFirst(isHeavyweightEvent);
  if (firstHeavy === undefined) return true; // all items are lightweight → drains everything
  // Check readiness (isEventReady is defined at module scope above).
  return isEventReady(firstHeavy); // ready heavyweight → batch drains it; not-ready → holds
}

/**
 * Returns the arrival timestamp (ms since epoch) of the newest pending text
 * or voice event in the session queue. Used by the silence detector to anchor
 * the elapsed clock to the most recent inbound content arrival.
 * Returns undefined if no queue exists or no matching event is pending.
 */
export function getPendingUserContentSince(sid: number): number | undefined {
  const queue = _queues.get(sid);
  if (!queue) return undefined;
  const evt = queue.peekLast(
    (e) => e.content.type === "text" || e.content.type === "voice",
  );
  return evt ? new Date(evt.timestamp).getTime() : undefined;
}

/** Number of active session queues. */
export function sessionQueueCount(): number {
  return _queues.size;
}

// ---------------------------------------------------------------------------
// Message ownership (outbound tracking)
// ---------------------------------------------------------------------------

/** AC4: callback invoked when a session confirms an outbound send. */
let _outboundSendCb: ((sid: number, now: number) => void) | undefined;

/**
 * Register a callback to be notified when a session sends an outbound message.
 * Called from index.ts during startup to wire the dequeue throttle (AC4 exemption).
 */
export function setOutboundSendCallback(cb: (sid: number, now: number) => void): void {
  _outboundSendCb = cb;
}

/**
 * Record that a bot message was sent by a specific session.
 * Called by outbound recording so inbound replies can route back.
 * Also updates last_sent_at for last_sent reminder tracking.
 */
export function trackMessageOwner(messageId: number, sid: number): void {
  if (sid > 0) {
    _messageOwnership.set(messageId, sid);
    const now = Date.now();
    recordLastSentAt(sid, now);
    // AC4: notify dequeue throttle that this session is actively sending.
    _outboundSendCb?.(sid, now);
  }
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
    notifyLastReceived(targetSid, event);
    return;
  }

  // Ambiguous: deliver to governor if set
  const gSid = getGovernorSid();
  if (gSid > 0 && _queues.has(gSid)) {
    dlog("route", `governor event=${event.id} → sid=${gSid}`, { type: event.content.type });
    enqueueToSession(gSid, event);
    // Do NOT call notifyLastReceived — ambiguous routing does not count as
    // "received by this session" for last_received reminder tracking.
    return;
  }

  // Fallback: broadcast to all sessions
  dlog("route", `broadcast event=${event.id} → ${_queues.size} sessions`);
  // Pass originatorSid so each session's SSE suppresses self-notifications (AC-1).
  const broadcastOriginatorSid = (event.sid !== undefined && event.sid > 0) ? event.sid : undefined;
  for (const [sid, q] of _queues.entries()) {
    q.enqueue(event);
    // Phase-1 voice suppression: suppress SSE notify for not-ready voice events.
    // Phase-2 SSE wake is fired by notifySessionWaiters() after transcription.
    if (isEventReady(event)) {
      notifySession(sid, "operator", isDequeueActive(sid), broadcastOriginatorSid);
    }
    // Always notify channel subscriber regardless of voice readiness.
    notifyChannelSubscriber(sid, event);
    // Do NOT call notifyLastReceived — broadcast/ambiguous routing does not
    // count as "received by this session" for last_received reminder tracking.
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
  // Phase-1 voice suppression: do NOT fire SSE notify for voice events that are
  // not yet ready (transcription pending). The phase-2 SSE wake is fired by
  // notifySessionWaiters() after patchVoiceText() completes. Firing here would
  // cause the agent to dequeue an empty batch and go back to sleep, missing the
  // real wake when transcription finishes.
  if (isEventReady(event)) {
    // Pass originatorSid so notifySession suppresses self-notifications (AC-1).
    const originatorSid = (event.sid !== undefined && event.sid > 0) ? event.sid : undefined;
    notifySession(sid, "operator", isDequeueActive(sid), originatorSid);
  }
  // Always notify channel subscriber regardless of voice readiness — channel
  // consumers handle not-ready events themselves.
  notifyChannelSubscriber(sid, event);
  // §5-b: Fire event-triggered reminders eagerly when events arrive for parked agents.
  // deliverReminderEvent calls q.enqueue directly (not via enqueueToSession) — no recursion risk.
  if (!isDequeueActive(sid)) {
    for (const r of popFireableEventReminders(sid)) {
      deliverReminderEvent(sid, buildReminderEvent(r));
    }
  }
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
 * Also called by shutdown and close-signal paths to unblock parked agents.
 *
 * Phase-2 SSE wake: after q.notifyWaiters() unblocks any agent blocked in
 * dequeue, fire notifySession for sessions that have content that is now
 * dequeue-able. This covers agents parked on SSE (not in dequeue) that missed
 * the phase-1 notify because the voice event was not yet ready at enqueue time.
 * Guard: only fire SSE if the session actually has pending dequeue-able content
 * (hasAnyPendingContent) — avoids spurious wakes for sessions with empty queues
 * or queues still blocked on a not-yet-ready heavyweight.
 */
export function notifySessionWaiters(): void {
  for (const [sid, q] of _queues.entries()) {
    q.notifyWaiters();
    // Fire SSE phase-2 wake only for sessions with content ready to dequeue.
    if (hasAnyPendingContent(sid)) {
      notifySession(sid, "operator", isDequeueActive(sid));
    }
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
let _nextAsyncCallbackId = -10_000_000;

// ---------------------------------------------------------------------------
// Async send callback delivery
// ---------------------------------------------------------------------------

/**
 * Payload delivered via dequeue when an async TTS send completes, fails, or times out.
 */
export interface AsyncSendCallbackPayload {
  /** Correlation ID — matches the message_id_pending returned by the original send. */
  pendingId: number;
  /** Outcome of the async send. */
  status: "ok" | "failed" | "timeout";
  /** Primary message ID (voice send with single chunk). */
  messageId?: number;
  /** All message IDs (voice send with multiple chunks). */
  messageIds?: number[];
  /** Error description (status: "failed"). */
  error?: string;
  /** Structured error code (status: "failed"). E.g. "tts_timeout". */
  error_code?: string;
  /** True when a plain-text fallback was sent instead of voice. */
  textFallback?: boolean;
  /** Message ID of the caption overflow follow-up text message. */
  textMessageId?: number;
}

/**
 * Deliver an async send result to the originating session's queue.
 * Injects a synthetic TimelineEvent with event: "send_callback".
 * Returns true if delivered, false if the session queue no longer exists.
 *
 * send_callback is intentionally lightweight (delivered before heavyweight
 * user content in dequeue batches) — it carries no user message body, only
 * a small correlation payload, so it does not hold up the batch delimiter.
 */
export function deliverAsyncSendCallback(
  targetSid: number,
  payload: AsyncSendCallbackPayload,
): boolean {
  const q = _queues.get(targetSid);
  if (!q) return false;

  const event: TimelineEvent = {
    id: _nextAsyncCallbackId--,
    timestamp: new Date().toISOString(),
    event: "send_callback",
    from: "system",
    content: {
      type: "send_callback",
      ...(payload.error !== undefined && { text: payload.error }),
      details: payload as unknown as Record<string, unknown>,
    },
    sid: targetSid,
  };

  q.enqueue(event);
  // send_callback is bridge-internal housekeeping — no notify
  dlog("async-send", `callback → sid=${targetSid}`, { pendingId: payload.pendingId, status: payload.status });
  // Update last_sent_at on confirmed async TTS delivery (message_id returned).
  if (payload.status === "ok" && (payload.messageId !== undefined || (payload.messageIds?.length ?? 0) > 0)) {
    recordLastSentAt(targetSid, Date.now());
  }
  return true;
}

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
  notifySession(targetSid, "operator", isDequeueActive(targetSid));
  notifyChannelSubscriber(targetSid, event);
  dlog("dm", `delivered DM from sid=${senderSid} → sid=${targetSid}`, { eventId: event.id });
  return true;
}

/**
 * A bundled service-message descriptor — `eventType` + `text` in one object.
 * Pass a static `SERVICE_MESSAGES.*` entry (from `service-messages.ts`) directly
 * as the second argument to `deliverServiceMessage` to avoid duplicating
 * `.text` / `.eventType` at every call site.
 */
export interface ServiceMessageSpec {
  eventType: string;
  text: string;
}

/**
 * Inject a server-generated service message into a session queue.
 * Returned events have `from: "system"` and `event: "service_message"`.
 * Returns false if the target queue does not exist.
 *
 * Two forms:
 *   - `deliverServiceMessage(sid, entry, details?)` — bundled entry form;
 *     pass a `SERVICE_MESSAGES.*` entry (or any `ServiceMessageSpec`) directly.
 *   - `deliverServiceMessage(sid, text, eventType, details?)` — raw-string form;
 *     used when the entry's `text` is a function (dynamic) and the caller
 *     already invoked it, or for inline one-off messages.
 */
export function deliverServiceMessage(
  targetSid: number,
  entry: ServiceMessageSpec,
  details?: Record<string, unknown>,
): boolean;
export function deliverServiceMessage(
  targetSid: number,
  text: string,
  eventType: string,
  details?: Record<string, unknown>,
  origin?: "bridge" | "child_forward",
): boolean;
export function deliverServiceMessage(
  targetSid: number,
  textOrEntry: string | ServiceMessageSpec,
  eventTypeOrDetails?: string | Record<string, unknown>,
  details?: Record<string, unknown>,
  origin?: "bridge" | "child_forward",
): boolean {
  const q = _queues.get(targetSid);
  if (!q) return false;

  let text: string;
  let eventType: string;
  let resolvedDetails: Record<string, unknown> | undefined;
  let resolvedOrigin: "bridge" | "child_forward";

  if (typeof textOrEntry === "object") {
    // Bundled entry form: deliverServiceMessage(sid, entry, details?)
    text = textOrEntry.text;
    eventType = textOrEntry.eventType;
    resolvedDetails = eventTypeOrDetails as Record<string, unknown> | undefined;
    resolvedOrigin = "bridge"; // bundled form always bridges — R1 single converged path
  } else {
    // Raw-string form: deliverServiceMessage(sid, text, eventType, details?, origin?)
    text = textOrEntry;
    eventType = eventTypeOrDetails as string;
    resolvedDetails = details;
    resolvedOrigin = origin ?? "bridge";
  }

  const event: TimelineEvent = {
    id: _nextServiceId--,
    timestamp: new Date().toISOString(),
    event: "service_message",
    from: "system",
    content: { type: "service", text, event_type: eventType, origin: resolvedOrigin, ...(resolvedDetails && { details: resolvedDetails }) },
    sid: 0,
  };

  q.enqueue(event);
  // Suppress SSE notify for behavior_nudge events — they only occur during active sessions
  // so the agent is already in its dequeue loop and does not need a separate wake.
  // persistent_animation_running is intentionally NOT suppressed: it must wake an idle agent.
  const isSilentEvent = event.content.event_type?.startsWith("behavior_nudge");
  if (!isSilentEvent) {
    notifySession(targetSid, "service", isDequeueActive(targetSid));
  }
  notifyChannelSubscriber(targetSid, event);
  dlog("service", `service message → sid=${targetSid}`, { eventType, eventId: event.id });
  return true;
}

/**
 * Inject a child/notify service event into the parent session's queue.
 * Delivered with from: "child" so the parent can distinguish it from bridge service messages.
 * Returns false if the parent queue does not exist (revoked between caller's check and notify).
 */
export function deliverChildNotifyEvent(
  parentSid: number,
  callerSid: number,
  eventType: string,
  payload?: Record<string, unknown>,
): boolean {
  const q = _queues.get(parentSid);
  if (!q) return false;

  const event: TimelineEvent = {
    id: _nextServiceId--,
    timestamp: new Date().toISOString(),
    event: "service_message",
    from: "child",
    content: {
      type: "service",
      event_type: eventType,
      ...(payload !== undefined && { payload }),
      child_sid: callerSid,
      origin: "child_notify",
    },
    sid: callerSid,
  };

  q.enqueue(event);
  notifySession(parentSid, "service", isDequeueActive(parentSid));
  notifyChannelSubscriber(parentSid, event);
  dlog("service", `child_notify → sid=${parentSid}`, { eventType, callerSid });
  return true;
}

/**
 * Inject a reminder event into a session queue.
 * Used by session_start for startup reminders, the active-reminder sweep, the schedule
 * sweep, and the event-triggered path in enqueueToSession. (§5-b: no longer startup-only.)
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

  recordNonToolEvent("reminder_fire", targetSid, getSession(targetSid)?.name ?? "", src.text);
  q.enqueue(event);
  notifySession(targetSid, "reminder", isDequeueActive(targetSid));
  notifyChannelSubscriber(targetSid, event);
  dlog("service", `reminder delivered → sid=${targetSid}`, { reminderId: src.reminder_id });
  return true;
}

/**
 * Wire the reminder-fire callback so reminder-state.ts can deliver events through
 * session-queue.ts without a circular import. Call this once at server startup
 * (from index.ts) after both modules are fully initialized.
 */
export function initReminderFireCallback(): void {
  setReminderFireCallback(deliverReminderEvent);
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
  notifySession(targetSid, "operator", isDequeueActive(targetSid));
  notifyChannelSubscriber(targetSid, routed);
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
  _nextAsyncCallbackId = -10_000_000;
}

/** Exported for testing: returns whether an event qualifies as a last_received trigger. */
export function qualifyInboundForTest(event: TimelineEvent): { all: boolean; operator: boolean } {
  return qualifyInbound(event);
}
