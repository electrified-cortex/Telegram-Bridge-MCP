/**
 * Per-session message queues and inbound routing.
 *
 * Each session gets its own TwoLaneQueue<TimelineEvent>. When an inbound
 * update arrives, the router decides which session(s) receive it:
 *
 *   - Reply-to / callback / reaction → owning session (targeted)
 *   - Ambiguous (no reply context) → routed by active routing mode
 *     (load_balance, cascade, or governor; falls back to broadcast)
 *
 * The global queue in message-store remains the "session 0" fallback and
 * is always populated (backward compat). Session queues are additive —
 * they receive copies of the same event references.
 */

import { TwoLaneQueue } from "./two-lane-queue.js";
import type { TimelineEvent } from "./message-store.js";
import { getMessage, CURRENT } from "./message-store.js";
import { getRoutingMode, getGovernorSid } from "./routing-mode.js";
import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// Voice-ready predicate (shared with message-store's queue)
// ---------------------------------------------------------------------------

function isEventReady(event: TimelineEvent): boolean {
  const c = event.content;
  return !(c.type === "voice" && c.text === undefined);
}

function getEventId(event: TimelineEvent): number {
  return event.id;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** sid → per-session queue */
const _queues = new Map<number, TwoLaneQueue<TimelineEvent>>();

/** message_id → owning sid (tracks which session sent each bot message) */
const _messageOwnership = new Map<number, number>();

/** `${sid}:${eventId}` → epoch-ms deadline by which the session should pass_message */
const _cascadePassDeadlines = new Map<string, number>();

/** Idle session time window (ms) to handle or pass a cascade message. */
const CASCADE_IDLE_TIMEOUT_MS = 15_000;

/** Busy session time window (ms) to handle or pass a cascade message. */
const CASCADE_BUSY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------

/** Create a queue for a new session. Returns false if already exists. */
export function createSessionQueue(sid: number): boolean {
  if (_queues.has(sid)) return false;
  _queues.set(sid, new TwoLaneQueue<TimelineEvent>({
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
export function getSessionQueue(sid: number): TwoLaneQueue<TimelineEvent> | undefined {
  return _queues.get(sid);
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
 *   2. Ambiguous (no reply context) → depends on routing mode:
 *      - load_balance: round-robin among idle sessions (fair distribution)
 *      - cascade: lowest-SID idle session first (priority hierarchy)
 *      - governor: deliver to the governor session only
 *
 * The global queue in message-store is NOT touched here — it's
 * populated by recordInbound as before. This is additive.
 */
export function routeToSession(event: TimelineEvent, lane: "response" | "message"): void {
  if (_queues.size === 0) return;

  const targetSid = resolveTargetSession(event);

  if (targetSid > 0) {
    // Targeted: deliver only to the owning session
    dlog("route", `targeted event=${event.id} → sid=${targetSid}`, { lane, type: event.content.type });
    enqueueToSession(targetSid, event, lane);
    return;
  }

  // Ambiguous routing — strategy depends on mode
  const mode = getRoutingMode();

  if (mode === "load_balance") {
    const sid = pickRoundRobin();
    if (sid > 0) {
      dlog("route", `load_balance event=${event.id} → sid=${sid}`, { lane, type: event.content.type });
      enqueueToSession(sid, event, lane);
      return;
    }
  } else if (mode === "cascade") {
    const sid = pickCascade();
    if (sid > 0) {
      const isIdle = _queues.get(sid)?.hasPendingWaiters() ?? false;
      const deadlineMs = Date.now() + (isIdle ? CASCADE_IDLE_TIMEOUT_MS : CASCADE_BUSY_TIMEOUT_MS);
      _cascadePassDeadlines.set(`${sid}:${event.id}`, deadlineMs);
      dlog("cascade", `routed event=${event.id} → sid=${sid} idle=${isIdle}`, { deadlineMs, lane });
      enqueueToSession(sid, event, lane);
      return;
    }
  } else {
    // governor mode
    const gSid = getGovernorSid();
    if (gSid > 0 && _queues.has(gSid)) {
      dlog("route", `governor event=${event.id} → sid=${gSid}`, { lane, type: event.content.type });
      enqueueToSession(gSid, event, lane);
      return;
    }
  }

  // Final fallback: broadcast to all sessions
  dlog("route", `broadcast event=${event.id} → ${_queues.size} sessions`, { mode, lane });
  for (const q of _queues.values()) {
    if (lane === "response") q.enqueueResponse(event);
    else q.enqueueMessage(event);
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
  lane: "response" | "message",
): void {
  const q = _queues.get(sid);
  if (!q) return;
  if (lane === "response") q.enqueueResponse(event);
  else q.enqueueMessage(event);
}

/** Last SID routed to in load_balance mode (for round-robin). */
let _lastRoutedSid = 0;

/**
 * Round-robin among idle sessions (load_balance mode).
 * Starts after `_lastRoutedSid` and wraps around.
 * Falls back to the lowest-SID session if none are idle.
 */
function pickRoundRobin(): number {
  const sids = [..._queues.keys()].sort((a, b) => a - b);
  if (sids.length === 0) return 0;

  // Find idle sessions via round-robin starting after _lastRoutedSid
  const startIdx = sids.findIndex(s => s > _lastRoutedSid);
  const ordered = startIdx > 0
    ? [...sids.slice(startIdx), ...sids.slice(0, startIdx)]
    : sids; // startIdx 0 or -1 means start from beginning

  for (const sid of ordered) {
    if (_queues.get(sid)?.hasPendingWaiters()) {
      _lastRoutedSid = sid;
      return sid;
    }
  }

  // No idle sessions — fall back to next in round-robin order
  _lastRoutedSid = ordered[0];
  return ordered[0];
}

/**
 * Cascade: always prefer the lowest-SID idle session (priority hierarchy).
 * Falls back to the lowest SID if none are idle.
 */
function pickCascade(): number {
  let idleSid = 0;
  let fallbackSid = 0;
  for (const [sid, q] of _queues) {
    if (fallbackSid === 0 || sid < fallbackSid) fallbackSid = sid;
    if (q.hasPendingWaiters() && (idleSid === 0 || sid < idleSid)) {
      idleSid = sid;
    }
  }
  return idleSid > 0 ? idleSid : fallbackSid;
}

// ---------------------------------------------------------------------------
// Cross-session outbound forwarding
// ---------------------------------------------------------------------------

/**
 * Forward an outbound bot event to all sessions *except* the sender.
 * Lets other sessions see what the sending session sent. Enqueued
 * to the response lane (high priority) since it's a status update,
 * not user input that blocks on processing.
 */
export function broadcastOutbound(event: TimelineEvent, senderSid: number): void {
  if (_queues.size <= 1) return;
  for (const [sid, q] of _queues) {
    if (sid === senderSid) continue;
    q.enqueueResponse(event);
  }
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
 * dequeue_update). Used by the poller to decide whether to skip setting 😴 —
 * if a session agent is waiting, it will dequeue and set 🫡 itself.
 */
export function hasAnySessionWaiter(): boolean {
  for (const q of _queues.values()) {
    if (q.hasPendingWaiters()) return true;
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

  q.enqueueMessage(event);
  dlog("dm", `delivered DM from sid=${senderSid} → sid=${targetSid}`, { eventId: event.id });
  return true;
}

/**
 * Consume and return the cascade pass deadline for a given session + event.
 * Returns undefined if no deadline exists (event wasn't cascade-routed).
 * Clears the deadline on read — call once per dequeue.
 */
export function popCascadePassDeadline(sid: number, eventId: number): number | undefined {
  const key = `${sid}:${eventId}`;
  const deadline = _cascadePassDeadlines.get(key);
  if (deadline !== undefined) _cascadePassDeadlines.delete(key);
  return deadline;
}

/**
 * Pass a message to the next session in cascade order.
 * The session that currently holds the message calls this to forward it.
 * Returns the SID the message was forwarded to, or 0 on failure.
 *
 * Failure reasons: message not found in store, no next session available,
 * or `fromSid` is already the last session in cascade order.
 */
export function passMessage(fromSid: number, messageId: number): number {
  const event = getMessage(messageId, CURRENT);
  if (!event) return 0;

  const sids = [..._queues.keys()].sort((a, b) => a - b);
  const idx = sids.indexOf(fromSid);
  if (idx < 0) return 0;

  // Clear any pending pass deadline for the passing session
  _cascadePassDeadlines.delete(`${fromSid}:${messageId}`);

  // Try sessions after fromSid in cascade order
  for (let i = idx + 1; i < sids.length; i++) {
    const targetSid = sids[i];
    const q = _queues.get(targetSid);
    if (q) {
      dlog("cascade", `pass msg=${messageId} from sid=${fromSid} → sid=${targetSid}`);
      q.enqueueMessage(event);
      return targetSid;
    }
  }

  // fromSid is last — nowhere to pass
  return 0;
}

/**
 * Route a message to a specific target session (governor delegation).
 * Returns true if delivered, false if message or target queue not found.
 */
export function routeMessage(messageId: number, targetSid: number): boolean {
  const event = getMessage(messageId, CURRENT);
  if (!event) return false;

  const q = _queues.get(targetSid);
  if (!q) return false;

  q.enqueueMessage(event);
  dlog("route", `governor delegated msg=${messageId} → sid=${targetSid}`);
  return true;
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetSessionQueuesForTest(): void {
  _queues.clear();
  _messageOwnership.clear();
  _cascadePassDeadlines.clear();
  _lastRoutedSid = 0;
  _nextDmId = -1;
}
