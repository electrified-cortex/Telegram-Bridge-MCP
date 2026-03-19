/**
 * Multi-session integration tests.
 *
 * These test scenarios with 2–3 active sessions interacting through
 * the real session-manager, session-queue, routing-mode, and dm-permissions
 * modules. Only message-store's `getMessage` is mocked (needed by
 * passMessage / routeMessage which look up events by ID).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TimelineEvent } from "./message-store.js";

// ---------------------------------------------------------------------------
// Mock message-store (passMessage / routeMessage need getMessage)
// ---------------------------------------------------------------------------

const mockGetMessage = vi.fn<() => TimelineEvent | undefined>();

vi.mock("./message-store.js", () => ({
  getMessage: (...args: unknown[]) => mockGetMessage(...args as []),
  CURRENT: -1,
}));

import {
  createSession,
  setActiveSession,
  getActiveSession,
  closeSession,
  listSessions,
  resetSessions,
} from "./session-manager.js";
import {
  createSessionQueue,
  removeSessionQueue,
  getSessionQueue,
  sessionQueueCount,
  trackMessageOwner,
  getMessageOwner,
  routeToSession,
  broadcastOutbound,
  deliverDirectMessage,
  routeMessage,
  notifySessionWaiters,
  resetSessionQueuesForTest,
} from "./session-queue.js";
import {
  setGovernorSid,
  getGovernorSid,
  resetRoutingModeForTest,
} from "./routing-mode.js";
import {
  hasDmPermission,
  revokeAllForSession,
  resetDmPermissionsForTest,
} from "./dm-permissions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _eventId = 1;

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: _eventId++,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text: "hello" },
    ...overrides,
  };
}

function replyEvent(replyTo: number): TimelineEvent {
  return makeEvent({
    content: { type: "text", text: "reply", reply_to: replyTo },
  });
}

function callbackEvent(target: number): TimelineEvent {
  return makeEvent({
    event: "callback",
    content: { type: "cb", data: "yes", target },
  });
}

/** Drain all pending items from a session queue. */
function drain(sid: number): TimelineEvent[] {
  const q = getSessionQueue(sid);
  if (!q) return [];
  const items: TimelineEvent[] = [];
  let item = q.dequeue();
  while (item) {
    items.push(item);
    item = q.dequeue();
  }
  return items;
}

/** Create a session and its queue in one step. */
function setupSession(name = "") {
  const s = createSession(name);
  createSessionQueue(s.sid);
  return s;
}

// ---------------------------------------------------------------------------
// Setup — reset all module state between tests
// ---------------------------------------------------------------------------

describe("multi-session integration", () => {
  beforeEach(() => {
    resetSessions();
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    resetDmPermissionsForTest();
    mockGetMessage.mockReset();
    _eventId = 1;
  });

  // =========================================================================
  // 1. Session lifecycle
  // =========================================================================

  describe("session lifecycle", () => {
    it("creates 3 sessions with sequential SIDs and queues", () => {
      const s1 = setupSession("Agent A");
      const s2 = setupSession("Agent B");
      const s3 = setupSession("Agent C");

      expect(s1.sid).toBe(1);
      expect(s2.sid).toBe(2);
      expect(s3.sid).toBe(3);

      expect(sessionQueueCount()).toBe(3);
      expect(listSessions()).toHaveLength(3);
    });

    it("closing a session removes its queue and session entry", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      closeSession(s2.sid);
      removeSessionQueue(s2.sid);

      expect(sessionQueueCount()).toBe(1);
      expect(listSessions()).toHaveLength(1);
      expect(getSessionQueue(s2.sid)).toBeUndefined();
      expect(getSessionQueue(s1.sid)).toBeDefined();
    });

    it("closing a session clears its message ownership entries", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      trackMessageOwner(100, s1.sid);
      trackMessageOwner(200, s2.sid);

      removeSessionQueue(s2.sid);

      expect(getMessageOwner(100)).toBe(s1.sid);
      expect(getMessageOwner(200)).toBe(0); // cleaned up
    });

    it("closing a session does not throw (revokeAllForSession is a no-op)", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      expect(() => { revokeAllForSession(s2.sid); }).not.toThrow();
      // DM permissions are always-on; hasDmPermission still returns true
      expect(hasDmPermission(s1.sid, s2.sid)).toBe(true);
    });
  });

  // =========================================================================
  // 2. Broadcast routing (default — no governor set)
  // =========================================================================

  describe("broadcast routing (no governor)", () => {
    it("routes ambiguous message to all sessions when no governor is set", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      const event = makeEvent();
      routeToSession(event);

      // All sessions receive the broadcast
      expect(drain(s1.sid)).toEqual([event]);
      expect(drain(s2.sid)).toEqual([event]);
      expect(drain(s3.sid)).toEqual([event]);
    });

    it("single session receives the message (no broadcast)", () => {
      const s1 = setupSession("Solo");

      const event = makeEvent();
      routeToSession(event);

      expect(drain(s1.sid)).toEqual([event]);
    });

    it("no queues: routeToSession is a no-op", () => {
      const event = makeEvent();
      expect(() => { routeToSession(event); }).not.toThrow();
    });
  });

  // =========================================================================
  // 3. Governor routing
  // =========================================================================

  describe("governor routing", () => {
    it("routes all ambiguous messages to governor only", () => {
      const s1 = setupSession("Worker A");
      const s2 = setupSession("Governor");
      const s3 = setupSession("Worker B");

      setGovernorSid(s2.sid);

      const e1 = makeEvent();
      const e2 = makeEvent();
      routeToSession(e1);
      routeToSession(e2);

      expect(drain(s2.sid)).toEqual([e1, e2]);
      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s3.sid)).toEqual([]);
    });

    it("governor delegates with routeMessage to a specific session", () => {
      const s1 = setupSession("Worker");
      const s2 = setupSession("Governor");
      const s3 = setupSession("Worker B");

      setGovernorSid(s2.sid);

      const event = makeEvent();
      mockGetMessage.mockReturnValue(event);

      // Governor routes to s3
      const ok = routeMessage(event.id, s3.sid, s2.sid);
      expect(ok).toBe(true);
      expect(drain(s3.sid)).toEqual([
        {
          ...event,
          content: {
            ...event.content,
            routed_by: s2.sid,
          },
        },
      ]);
      expect(drain(s1.sid)).toEqual([]);
    });

    it("clearing governor SID falls back to broadcast", () => {
      const s1 = setupSession("Worker");
      const s2 = setupSession("Governor");

      setGovernorSid(s2.sid);
      expect(getGovernorSid()).toBe(s2.sid);

      // Clear governor
      setGovernorSid(0);
      expect(getGovernorSid()).toBe(0);

      // New ambiguous message should broadcast to both sessions
      const event = makeEvent();
      routeToSession(event);
      expect(drain(s1.sid)).toEqual([event]);
      expect(drain(s2.sid)).toEqual([event]);
    });
  });

  // =========================================================================
  // 5. Targeted routing (reply-to / callback / reaction)
  // =========================================================================

  describe("targeted routing", () => {
    it("reply-to routes only to owning session among 3", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      // SID 2 sent bot message 50
      trackMessageOwner(50, s2.sid);

      // User replies to message 50
      const reply = replyEvent(50);
      routeToSession(reply);

      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s2.sid)).toEqual([reply]);
      expect(drain(s3.sid)).toEqual([]);
    });

    it("callback routes only to owning session", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      trackMessageOwner(70, s1.sid);

      const cb = callbackEvent(70);
      routeToSession(cb);

      expect(drain(s1.sid)).toEqual([cb]);
      expect(drain(s2.sid)).toEqual([]);
    });

    it("reply to unknown message broadcasts to all sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // reply_to message ID with no owner → ambiguous → broadcast
      const reply = replyEvent(999);
      routeToSession(reply);

      // Both sessions receive it (broadcast fallback)
      expect(drain(s1.sid)).toEqual([reply]);
      expect(drain(s2.sid)).toEqual([reply]);
    });
  });

  // =========================================================================
  // 6. Cross-session broadcast
  // =========================================================================

  describe("cross-session broadcast", () => {
    it("outbound from SID 1 goes to governor only, not other sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("Governor");
      const s3 = setupSession("C");
      setGovernorSid(s2.sid);

      const outEvent = makeEvent({
        event: "message",
        from: "bot",
        content: { type: "text", text: "status update" },
        sid: s1.sid,
      });

      broadcastOutbound(outEvent, s1.sid);

      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s2.sid)).toEqual([outEvent]); // governor receives
      expect(drain(s3.sid)).toEqual([]);         // non-governor skipped
    });

    it("no broadcast when no governor is set", () => {
      const s1 = setupSession("Solo");
      setupSession("B");

      const outEvent = makeEvent({ from: "bot", sid: s1.sid });
      broadcastOutbound(outEvent, s1.sid);

      expect(drain(s1.sid)).toEqual([]);
    });

    it("no broadcast when sender is the governor", () => {
      const s1 = setupSession("Governor");
      const s2 = setupSession("Worker");
      setGovernorSid(s1.sid);

      const outEvent = makeEvent({ from: "bot", sid: s1.sid });
      broadcastOutbound(outEvent, s1.sid); // sender === governor → skip

      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s2.sid)).toEqual([]);
    });
  });

  // =========================================================================
  // 7. Direct messages
  // =========================================================================

  describe("direct messages", () => {
    it("delivers DM between sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      const ok = deliverDirectMessage(s1.sid, s2.sid, "hello from A");
      expect(ok).toBe(true);

      const items = drain(s2.sid);
      expect(items).toHaveLength(1);
      expect(items[0].event).toBe("direct_message");
      expect(items[0].content.text).toBe("hello from A");
      expect(items[0].sid).toBe(s1.sid);

      // Sender doesn't see their own DM
      expect(drain(s1.sid)).toEqual([]);
    });

    it("DM is always permitted between sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      expect(hasDmPermission(s1.sid, s2.sid)).toBe(true);
      expect(hasDmPermission(s2.sid, s1.sid)).toBe(true);
    });

    it("bidirectional DM exchange", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      deliverDirectMessage(s1.sid, s2.sid, "ping");
      deliverDirectMessage(s2.sid, s1.sid, "pong");

      const s1Items = drain(s1.sid);
      const s2Items = drain(s2.sid);

      expect(s2Items).toHaveLength(1);
      expect(s2Items[0].content.text).toBe("ping");

      expect(s1Items).toHaveLength(1);
      expect(s1Items[0].content.text).toBe("pong");
    });

    it("DM fails when target session is closed", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      closeSession(s2.sid);
      removeSessionQueue(s2.sid);

      const ok = deliverDirectMessage(s1.sid, s2.sid, "hello?");
      expect(ok).toBe(false);
    });

    it("DM IDs are negative to avoid collision with real messages", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      deliverDirectMessage(s1.sid, s2.sid, "first");
      deliverDirectMessage(s1.sid, s2.sid, "second");

      const items = drain(s2.sid);
      expect(items[0].id).toBeLessThan(0);
      expect(items[1].id).toBeLessThan(0);
      expect(items[0].id).not.toBe(items[1].id);
    });
  });

  // =========================================================================
  // 8. Combined scenarios
  // =========================================================================

  describe("combined scenarios", () => {
    it("session creates, routes, broadcasts, DMs, then closes cleanly", () => {
      // Full lifecycle: 3 sessions, messages, DMs, then close one
      const s1 = setupSession("Worker A");
      const s2 = setupSession("Worker B");
      const s3 = setupSession("Supervisor");

      // Track some outbound messages
      trackMessageOwner(100, s1.sid);
      trackMessageOwner(200, s2.sid);

      // Route targeted reply to s1
      const reply = replyEvent(100);
      routeToSession(reply);
      expect(drain(s1.sid)).toEqual([reply]);
      expect(drain(s2.sid)).toEqual([]);

      // Broadcast from s2 goes to governor (s3) only
      const broadcast = makeEvent({ from: "bot", sid: s2.sid });
      setGovernorSid(s3.sid);
      broadcastOutbound(broadcast, s2.sid);
      expect(drain(s3.sid)).toEqual([broadcast]);
      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s2.sid)).toEqual([]);
      setGovernorSid(0); // clear governor for remaining assertions

      // DM from s3 to s1
      deliverDirectMessage(s3.sid, s1.sid, "task update");
      const dm = drain(s1.sid);
      expect(dm).toHaveLength(1);
      expect(dm[0].content.text).toBe("task update");

      // Close s2 — cleanup
      closeSession(s2.sid);
      removeSessionQueue(s2.sid);
      revokeAllForSession(s2.sid);

      expect(sessionQueueCount()).toBe(2);
      expect(getMessageOwner(200)).toBe(0); // cleaned up
      expect(getMessageOwner(100)).toBe(s1.sid); // s1 still alive
    });

    it("switching to governor mode mid-session changes behavior", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      // Start without governor (broadcast)
      const e1 = makeEvent();
      routeToSession(e1);
      // All sessions get it (broadcast)
      expect(drain(s1.sid).length + drain(s2.sid).length + drain(s3.sid).length).toBe(3);

      // Switch to governor
      setGovernorSid(s2.sid);
      const e2 = makeEvent();
      routeToSession(e2);
      expect(drain(s2.sid)).toEqual([e2]);
      expect(drain(s1.sid)).toEqual([]);
      expect(drain(s3.sid)).toEqual([]);
    });

    it("active session context tracks which session is executing", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      expect(getActiveSession()).toBe(0);

      setActiveSession(s1.sid);
      expect(getActiveSession()).toBe(s1.sid);

      setActiveSession(s2.sid);
      expect(getActiveSession()).toBe(s2.sid);

      setActiveSession(0);
      expect(getActiveSession()).toBe(0);
    });
  });

  // =========================================================================
  // 9. Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("ownership survives even after queue removal (ownership ≠ queue)", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      trackMessageOwner(50, s1.sid);
      trackMessageOwner(60, s2.sid);

      // Remove s2's queue but DON'T remove its ownership (happens if close_session
      // is called without removeSessionQueue, or if ownership is not cleaned up)
      // removeSessionQueue DOES clean up, so verify that
      removeSessionQueue(s2.sid);

      expect(getMessageOwner(50)).toBe(s1.sid); // s1 untouched
      expect(getMessageOwner(60)).toBe(0); // s2 cleaned

      // s1 ownership still works for routing
      createSessionQueue(3); // new session queue
      const reply = replyEvent(50);
      routeToSession(reply);
      expect(drain(s1.sid)).toEqual([reply]); // still routes to s1
    });

    it("broadcast wakes governor queue waiter", async () => {
      const s1 = setupSession("A");
      const s2 = setupSession("Governor");
      setGovernorSid(s2.sid);

      const q2 = getSessionQueue(s2.sid)!;

      let woken = false;
      const waiter = q2.waitForEnqueue().then(() => { woken = true; });

      // Broadcast from s1 should wake governor's waiter
      broadcastOutbound(makeEvent({ from: "bot", sid: s1.sid }), s1.sid);

      await waiter;
      expect(woken).toBe(true);
    });

    it("notifySessionWaiters wakes all session queues", async () => {
      setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      const q2 = getSessionQueue(s2.sid)!;
      const q3 = getSessionQueue(s3.sid)!;

      let woken2 = false;
      let woken3 = false;
      const w2 = q2.waitForEnqueue().then(() => { woken2 = true; });
      const w3 = q3.waitForEnqueue().then(() => { woken3 = true; });

      notifySessionWaiters();

      await Promise.all([w2, w3]);
      expect(woken2).toBe(true);
      expect(woken3).toBe(true);
    });

    it("targeted routing still works in governor mode", () => {
      const s1 = setupSession("Worker");
      const s2 = setupSession("Governor");

      setGovernorSid(s2.sid);
      trackMessageOwner(100, s1.sid);

      // User replies to s1's message — should go to s1, not governor
      const reply = replyEvent(100);
      routeToSession(reply);

      expect(drain(s1.sid)).toEqual([reply]);
      expect(drain(s2.sid)).toEqual([]);
    });

    it("temporal ordering — first enqueued arrives first", () => {
      const s1 = setupSession("A");

      const q1 = getSessionQueue(s1.sid)!;

      // Enqueue in temporal order: msg first, then resp
      const msg = makeEvent({ content: { type: "text", text: "msg" } });
      const resp = makeEvent({ content: { type: "text", text: "resp" } });

      q1.enqueue(msg);    // arrives first — temporal order wins
      q1.enqueue(resp);  // arrives second

      // Temporal order: msg comes out first
      const first = q1.dequeue();
      expect(first?.content.text).toBe("msg");
      const second = q1.dequeue();
      expect(second?.content.text).toBe("resp");
    });

    it("no queues: routeToSession is a no-op", () => {
      // No sessions created — should not throw
      const event = makeEvent();
      expect(() => { routeToSession(event); }).not.toThrow();
    });

    it("DM to self delivers to own queue", () => {
      const s1 = setupSession("Solo");

      const ok = deliverDirectMessage(s1.sid, s1.sid, "talking to myself");
      expect(ok).toBe(true);

      const items = drain(s1.sid);
      expect(items).toHaveLength(1);
      expect(items[0].content.text).toBe("talking to myself");
    });

    it("multiple ambiguous messages broadcast to all sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // Send 4 messages
      const events = [makeEvent(), makeEvent(), makeEvent(), makeEvent()];
      for (const e of events) routeToSession(e);

      const got1 = drain(s1.sid);
      const got2 = drain(s2.sid);

      // Both sessions get all 4 messages
      expect(got1).toHaveLength(4);
      expect(got2).toHaveLength(4);
    });

    it("governor fallback broadcasts when governor queue is missing", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // Set governor to SID 99 which has no queue
      setGovernorSid(99);

      const event = makeEvent();
      routeToSession(event);

      // Falls back to broadcast
      expect(drain(s1.sid)).toEqual([event]);
      expect(drain(s2.sid)).toEqual([event]);
    });
  });

  // -------------------------------------------------------------------------
  // Queue isolation & delivery exactness
  // -------------------------------------------------------------------------
  describe("queue isolation & delivery exactness", () => {
    it("targeted routing delivers to exactly one session when multiple exist", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      // S2 owns message 500
      trackMessageOwner(500, s2.sid);

      // Reply to message 500 — should go only to S2
      const reply = replyEvent(500);
      routeToSession(reply);

      expect(drain(s1.sid)).toHaveLength(0);
      expect(drain(s2.sid)).toHaveLength(1);
      expect(drain(s3.sid)).toHaveLength(0);

      // Callback on message 500 — should go only to S2
      const cb = callbackEvent(500);
      routeToSession(cb);

      expect(drain(s1.sid)).toHaveLength(0);
      expect(drain(s2.sid)).toHaveLength(1);
      expect(drain(s3.sid)).toHaveLength(0);
    });

    it("session queues are fully isolated — targeted messages go to owner only", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // S1 owns messages 400, 401
      trackMessageOwner(400, s1.sid);
      trackMessageOwner(401, s2.sid);

      routeToSession(replyEvent(400)); // → S1
      routeToSession(replyEvent(401)); // → S2

      expect(drain(s1.sid)).toHaveLength(1);
      expect(drain(s2.sid)).toHaveLength(1);
    });

    it("governor delivers to exactly one session — the governor", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");
      setGovernorSid(s2.sid);

      const event = makeEvent();
      routeToSession(event);

      expect(drain(s1.sid)).toHaveLength(0);
      expect(drain(s2.sid)).toHaveLength(1);
      expect(drain(s3.sid)).toHaveLength(0);
    });

    it("broadcast (fallback) delivers to all sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      // Governor with missing SID triggers fallback broadcast
      setGovernorSid(999);

      const event = makeEvent();
      routeToSession(event);

      expect(drain(s1.sid)).toHaveLength(1);
      expect(drain(s2.sid)).toHaveLength(1);
    });

    it("response-lane events route without duplication in session queues", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // S1 owns message 100
      trackMessageOwner(100, s1.sid);

      // Reaction targeting message 100 — response-lane targeted at S1
      const reaction = makeEvent({
        event: "reaction",
        content: { type: "reaction", target: 100, added: ["👍"], removed: [] },
      });
      routeToSession(reaction);

      // Only S1 gets it, S2 does not
      expect(drain(s1.sid)).toHaveLength(1);
      expect(drain(s2.sid)).toHaveLength(0);
    });

    it("DM delivery does not leak to other sessions", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      const s3 = setupSession("C");

      deliverDirectMessage(s1.sid, s2.sid, "secret message");

      // Only S2 should have it
      expect(drain(s1.sid)).toHaveLength(0);
      expect(drain(s2.sid)).toHaveLength(1);
      expect(drain(s3.sid)).toHaveLength(0);
    });

    it("mixed targeted + ambiguous messages route correctly in governor mode", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");
      setGovernorSid(s2.sid);

      // S1 owns message 200
      trackMessageOwner(200, s1.sid);

      // Targeted → S1, ambiguous → S2 (governor), targeted→S1, ambiguous→S2
      routeToSession(replyEvent(200));       // → S1 (targeted)
      routeToSession(makeEvent());            // → S2 (governor)
      routeToSession(callbackEvent(200));    // → S1 (targeted)
      routeToSession(makeEvent());            // → S2 (governor)

      const got1 = drain(s1.sid);
      const got2 = drain(s2.sid);

      // S1 gets 2 targeted messages
      expect(got1.length).toBe(2);
      // S2 gets 2 ambiguous messages
      expect(got2.length).toBe(2);

      // Total is exactly 4, no duplicates
      expect(got1.length + got2.length).toBe(4);
      const allIds = [...got1, ...got2].map(e => e.id);
      expect(new Set(allIds).size).toBe(4);
    });
  });

  // =========================================================================
  // 9. Cross-session isolation (end-to-end with real queues)
  // =========================================================================

  describe("cross-session isolation (e2e)", () => {
    it("dequeuing from SID 1 never returns SID 2 messages", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // With no governor, ambiguous messages broadcast to all sessions
      for (let i = 0; i < 10; i++) {
        routeToSession(makeEvent());
      }

      // Drain S1 only — gets all 10 broadcast messages
      const got1 = drain(s1.sid);
      expect(got1).toHaveLength(10);

      // S2 still has all 10 — draining S1 didn't touch S2's queue
      const q2 = getSessionQueue(s2.sid)!;
      expect(q2.pendingCount()).toBe(10);

      // Drain S2 — also gets all 10
      const got2 = drain(s2.sid);
      expect(got2).toHaveLength(10);
    });

    it("wrong SID returns nothing (queue exists but empty)", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // S1 owns message 300
      trackMessageOwner(300, s1.sid);

      // Reply to 300 → targeted at S1
      routeToSession(replyEvent(300));

      // S2 should have nothing
      expect(drain(s2.sid)).toHaveLength(0);
      // S1 gets it
      expect(drain(s1.sid)).toHaveLength(1);
    });

    it("closing session does not relocate its queued messages", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      // With broadcast, both sessions get all 6 messages
      for (let i = 0; i < 6; i++) {
        routeToSession(makeEvent());
      }

      // Close S1 — its queue is removed, S2 unaffected
      closeSession(s1.sid);
      removeSessionQueue(s1.sid);

      // S2 still has all 6 — closing S1 doesn't affect S2
      expect(drain(s2.sid)).toHaveLength(6);
    });
  });

  // =========================================================================
  // 10. High-concurrency stress test
  // =========================================================================

  describe("high-concurrency routing", () => {
    it("50 messages across 5 sessions: all received by all (broadcast)",
      () => {
        const sessions = Array.from(
          { length: 5 },
          (_, i) => setupSession(`S${i + 1}`),
        );

        const total = 50;
        const sent: TimelineEvent[] = [];
        for (let i = 0; i < total; i++) sent.push(makeEvent());
        for (const e of sent) routeToSession(e);

        const sentIds = sent.map(e => e.id).sort((a, b) => a - b);

        // Each session independently receives all 50 broadcast messages
        for (const s of sessions) {
          const received = drain(s.sid);
          expect(received).toHaveLength(total);
          const gotIds = received.map(e => e.id).sort((a, b) => a - b);
          expect(gotIds).toEqual(sentIds);
        }
      },
    );

    it("mixed routing modes: targeted + broadcast + governor",
      () => {
        const s1 = setupSession("A");
        const s2 = setupSession("B");
        const s3 = setupSession("C");

        // S2 owns messages 500, 501
        trackMessageOwner(500, s2.sid);
        trackMessageOwner(501, s2.sid);

        // 3 targeted replies → S2 only
        routeToSession(replyEvent(500));
        routeToSession(replyEvent(501));
        routeToSession(callbackEvent(500));

        // 3 broadcast messages → all sessions (no governor)
        const broadcastEvents: TimelineEvent[] = [];
        for (let i = 0; i < 3; i++) {
          const e = makeEvent();
          broadcastEvents.push(e);
          routeToSession(e);
        }

        // Switch to governor mode → S1
        setGovernorSid(s1.sid);

        // 3 governor messages → S1 only
        const govEvents: TimelineEvent[] = [];
        for (let i = 0; i < 3; i++) {
          const e = makeEvent();
          govEvents.push(e);
          routeToSession(e);
        }

        const got1 = drain(s1.sid);
        const got2 = drain(s2.sid);
        const got3 = drain(s3.sid);

        // S1: 3 broadcast + 3 governor = 6
        expect(got1).toHaveLength(6);
        // S2: 3 targeted + 3 broadcast = 6
        expect(got2).toHaveLength(6);
        // S3: 3 broadcast only = 3
        expect(got3).toHaveLength(3);

        // S1 got all governor messages
        const govIds = new Set(govEvents.map(e => e.id));
        for (const ge of govEvents) {
          expect(got1.map(e => e.id)).toContain(ge.id);
        }

        // No governor messages in S2 or S3
        for (const e of got2) expect(govIds.has(e.id)).toBe(false);
        for (const e of got3) expect(govIds.has(e.id)).toBe(false);
      },
    );
  });

  // =========================================================================
  // 11. DM edge cases
  // =========================================================================

  describe("DM edge cases", () => {
    it("DM to non-existent session returns false", () => {
      setupSession("A");
      // SID 999 never created
      const delivered = deliverDirectMessage(1, 999, "hello");
      expect(delivered).toBe(false);
    });

    it("DM to closed session returns false", () => {
      const s1 = setupSession("A");
      const s2 = setupSession("B");

      closeSession(s2.sid);
      removeSessionQueue(s2.sid);

      const delivered = deliverDirectMessage(
        s1.sid,
        s2.sid,
        "are you there?",
      );
      expect(delivered).toBe(false);
    });

    it("DM delivery fails when target queue is removed (permissions always-on)",
      () => {
        const s1 = setupSession("A");
        const s2 = setupSession("B");

        // Permissions are always-on
        expect(hasDmPermission(s1.sid, s2.sid)).toBe(true);

        // Close and remove S2's queue
        closeSession(s2.sid);
        removeSessionQueue(s2.sid);

        // Permission still true (always-on)
        expect(hasDmPermission(s1.sid, s2.sid)).toBe(true);

        // Delivery fails because queue is gone
        const delivered = deliverDirectMessage(
          s1.sid,
          s2.sid,
          "ghost message",
        );
        expect(delivered).toBe(false);
      },
    );
  });
});
