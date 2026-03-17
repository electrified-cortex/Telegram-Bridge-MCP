/**
 * Tool-level integration tests for multi-session workflows.
 *
 * Unlike unit tests (which mock session-manager and session-queue), these
 * tests wire real session infrastructure — session-manager, session-queue, and
 * routing-mode. Only the Telegram network layer and message-store are mocked.
 *
 * Covers the 8 scenarios from tasks/3-in-progress/150-integration-tests-multi-session.md:
 *   1. Two-session queue isolation
 *   2. SID_REQUIRED enforcement across tools
 *   3. Voice ack via session queue path
 *   4. Session close resets governor routing
 *   5. Rapid create/close — no SID reuse
 *   6. Non-blocking dequeue — empty queues
 *   7. Cross-session message passing (cascade)
 *   8. Load-balance queue independence
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TimelineEvent } from "../message-store.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks — telegram network layer only; session infrastructure stays real
// ---------------------------------------------------------------------------

const mockSendMessage = vi.fn();
const mockAckVoice = vi.fn();
const mockSendServiceMessage = vi.fn(() => Promise.resolve());

const _fakeApi = {
  sendMessage: (..._args: unknown[]) => mockSendMessage(),
};

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => _fakeApi,
    resolveChat: () => 1,
    ackVoiceMessage: (...args: unknown[]) => mockAckVoice(...args),
    sendServiceMessage: (...args: unknown[]) => mockSendServiceMessage(...args),
  };
});

// message-store: only getMessage is needed by passMessage / routeMessage.
// dequeueBatch / waitForEnqueue are only hit when no session queue exists (never
// in these tests — every test creates an explicit session queue for every SID).
const mockGetMessage = vi.fn<() => TimelineEvent | undefined>();

vi.mock("../message-store.js", () => ({
  getMessage: (...args: unknown[]) => mockGetMessage(...args as []),
  CURRENT: -1,
  dequeue: vi.fn(() => undefined),
  dequeueBatch: vi.fn(() => []),
  pendingCount: vi.fn(() => 0),
  waitForEnqueue: vi.fn(() => new Promise<void>(() => { /* never resolves */ })),
  replaceSessionCallbackHooks: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Real session infrastructure (no mock)
// ---------------------------------------------------------------------------

import {
  createSession,
  closeSession as closeSessionDirect,
  resetSessions,
} from "../session-manager.js";
import {
  createSessionQueue,
  removeSessionQueue,
  getSessionQueue,
  resetSessionQueuesForTest,
} from "../session-queue.js";
import {
  setRoutingMode,
  getRoutingMode,
  getGovernorSid,
  resetRoutingModeForTest,
} from "../routing-mode.js";
import { resetDmPermissionsForTest } from "../dm-permissions.js";

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

import { register as registerDequeue } from "./dequeue_update.js";
import { register as registerSendText } from "./send_text.js";
import { register as registerCloseSession } from "./close_session.js";
import { register as registerPassMessage } from "./pass_message.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _eid = 1000;

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: _eid++,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text: "hello" },
    ...overrides,
  };
}

function makeVoiceEvent(): TimelineEvent {
  return makeEvent({ content: { type: "voice", text: "transcribed text" } });
}

/** Extract JSON payload from a tool result. */
function parseTool(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: { text: string }[] }).content[0].text,
  ) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetSessions();
  resetSessionQueuesForTest();
  resetRoutingModeForTest();
  resetDmPermissionsForTest();
  mockSendMessage.mockResolvedValue({ message_id: 1 });
});

// ===========================================================================

describe("multi-session tool integration", () => {
  // -------------------------------------------------------------------------
  // Scenario 1: Two-session queue isolation
  // -------------------------------------------------------------------------
  describe("scenario 1: two-session queue isolation", () => {
    it("dequeue from SID 2 returns empty when message enqueued for SID 1", async () => {
      const { sid: sid1 } = createSession();
      createSessionQueue(sid1);
      const { sid: sid2 } = createSession();
      createSessionQueue(sid2);

      const event = makeEvent();
      getSessionQueue(sid1)!.enqueueMessage(event);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r2 = await dequeue({ timeout: 0, sid: sid2 });
      expect(isError(r2)).toBe(false);
      expect(parseTool(r2).empty).toBe(true);
    });

    it("dequeue from SID 1 returns the event enqueued for SID 1", async () => {
      const { sid: sid1 } = createSession();
      createSessionQueue(sid1);
      const { sid: sid2 } = createSession();
      createSessionQueue(sid2);

      const event = makeEvent();
      getSessionQueue(sid1)!.enqueueMessage(event);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1 = await dequeue({ timeout: 0, sid: sid1 });
      expect(isError(r1)).toBe(false);
      const updates = parseTool(r1).updates as unknown[];
      expect(updates).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: SID_REQUIRED enforcement across tools
  // -------------------------------------------------------------------------
  describe("scenario 2: SID_REQUIRED enforcement", () => {
    it("dequeue_update without sid returns SID_REQUIRED when 2+ sessions active", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerDequeue(server);
      const result = await server.getHandler("dequeue_update")({ timeout: 0 });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("send_text without identity returns SID_REQUIRED when 2+ sessions active", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerSendText(server);
      const result = await server.getHandler("send_text")({ text: "hello" });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("send_text with wrong pin returns AUTH_FAILED when 2+ sessions active", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerSendText(server);
      const result = await server.getHandler("send_text")({
        text: "hello",
        identity: [sid1, 99999],
      });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("send_text with valid identity succeeds in multi-session mode", async () => {
      const { sid, pin } = createSession(); createSessionQueue(sid);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerSendText(server);
      const result = await server.getHandler("send_text")({
        text: "hello",
        identity: [sid, pin],
      });

      expect(isError(result)).toBe(false);
      expect(parseResult(result)).toMatchObject({ message_id: 1 });
    });

    it("send_text without identity works in single-session mode (backward compat)", async () => {
      const server = createMockServer();
      registerSendText(server);
      const result = await server.getHandler("send_text")({ text: "hello" });

      expect(isError(result)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Voice ack via session queue path
  // -------------------------------------------------------------------------
  describe("scenario 3: voice ack via session queue", () => {
    it("ackVoiceMessage is called when voice event dequeued from session queue", async () => {
      const { sid } = createSession();
      createSessionQueue(sid);

      const voiceEvent = makeVoiceEvent();
      getSessionQueue(sid)!.enqueueMessage(voiceEvent);

      const server = createMockServer();
      registerDequeue(server);
      await server.getHandler("dequeue_update")({ timeout: 0, sid });

      expect(mockAckVoice).toHaveBeenCalledOnce();
      expect(mockAckVoice).toHaveBeenCalledWith(voiceEvent.id);
    });

    it("ackVoiceMessage is NOT called for non-voice events", async () => {
      const { sid } = createSession();
      createSessionQueue(sid);

      getSessionQueue(sid)!.enqueueMessage(makeEvent()); // text event

      const server = createMockServer();
      registerDequeue(server);
      await server.getHandler("dequeue_update")({ timeout: 0, sid });

      expect(mockAckVoice).not.toHaveBeenCalled();
    });

    it("ackVoiceMessage is called for each voice event in a batch", async () => {
      const { sid } = createSession();
      createSessionQueue(sid);

      // Two voice events to verify both are acked
      const v1 = makeVoiceEvent();
      const v2 = makeVoiceEvent();
      getSessionQueue(sid)!.enqueueMessage(v1);
      getSessionQueue(sid)!.enqueueMessage(v2);

      const server = createMockServer();
      registerDequeue(server);

      // First dequeue gets one message (TwoLaneQueue dequeues one message per batch)
      await server.getHandler("dequeue_update")({ timeout: 0, sid });
      // Second dequeue gets the next
      await server.getHandler("dequeue_update")({ timeout: 0, sid });

      expect(mockAckVoice).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Session close resets governor routing
  // -------------------------------------------------------------------------
  describe("scenario 4: session close resets governor routing", () => {
    it("closing governor session resets routing to load_balance when 1 session remains (2→1 teardown)", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      setRoutingMode("governor", sid1);

      expect(getRoutingMode()).toBe("governor");
      expect(getGovernorSid()).toBe(sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ sid: sid1, pin: pin1 });

      // 2→1 teardown: single-session mode restored, not governor promotion
      expect(getRoutingMode()).toBe("load_balance");
    });

    it("closing governor session resets routing to load_balance when no sessions remain", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      setRoutingMode("governor", sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ sid: sid1, pin: pin1 });

      expect(getRoutingMode()).toBe("load_balance");
      expect(getGovernorSid()).toBe(0);
    });

    it("closing a non-governor session resets routing when 1 session remains (2→1 teardown)", async () => {
      const { sid: sid1, pin: _pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);
      setRoutingMode("governor", sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ sid: sid2, pin: pin2 });

      // 2→1 teardown: routing resets regardless of which session closed
      expect(getRoutingMode()).toBe("load_balance");
    });

    it("close_session with wrong pin returns AUTH_FAILED and leaves routing intact", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      setRoutingMode("governor", sid1);

      const server = createMockServer();
      registerCloseSession(server);
      const result = await server.getHandler("close_session")({ sid: sid1, pin: 99999 });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
      expect(getRoutingMode()).toBe("governor");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Rapid create/close — no SID reuse
  // -------------------------------------------------------------------------
  describe("scenario 5: rapid create/close — no SID reuse", () => {
    it("SIDs are monotonically increasing and never reused after close", () => {
      const sids: number[] = [];
      for (let i = 0; i < 10; i++) {
        const { sid } = createSession();
        sids.push(sid);
        createSessionQueue(sid);
        closeSessionDirect(sid);
        removeSessionQueue(sid);
      }

      expect(new Set(sids).size).toBe(10);
      for (let i = 1; i < sids.length; i++) {
        expect(sids[i]).toBeGreaterThan(sids[i - 1]);
      }
    });

    it("active session count stays accurate through rapid churn", () => {
      const { sid: s1 } = createSession();
      const { sid: s2 } = createSession();
      const { sid: _s3 } = createSession();
      closeSessionDirect(s1);
      closeSessionDirect(s2);
      const { sid: s4 } = createSession();

      // s3 and s4 remain
      const server = createMockServer();
      registerDequeue(server);
      // Two sessions active — no sid arg should trigger SID_REQUIRED
      const dequeue = server.getHandler("dequeue_update");
      return dequeue({ timeout: 0 }).then((result) => {
        expect(isError(result)).toBe(true);
        expect(errorCode(result)).toBe("SID_REQUIRED");
        void s4; // suppress unused warning
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Non-blocking dequeue — empty queues
  // -------------------------------------------------------------------------
  describe("scenario 6: non-blocking dequeue — empty queues", () => {
    it("both sessions return empty on concurrent non-blocking polls", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const [r1, r2] = await Promise.all([
        dequeue({ timeout: 0, sid: sid1 }),
        dequeue({ timeout: 0, sid: sid2 }),
      ]);

      expect(parseTool(r1).empty).toBe(true);
      expect(parseTool(r2).empty).toBe(true);
    });

    it("only the session with a pending message gets it on concurrent polls", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      getSessionQueue(sid1)!.enqueueMessage(makeEvent());

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const [r1, r2] = await Promise.all([
        dequeue({ timeout: 0, sid: sid1 }),
        dequeue({ timeout: 0, sid: sid2 }),
      ]);

      expect(Array.isArray(parseTool(r1).updates)).toBe(true);
      expect(parseTool(r2).empty).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Cross-session message passing (cascade mode)
  // -------------------------------------------------------------------------
  describe("scenario 7: cross-session message passing", () => {
    it("pass_message delivers event to next session in cascade order", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      setRoutingMode("cascade");

      const event = makeEvent();
      mockGetMessage.mockReturnValue(event);

      const server = createMockServer();
      registerPassMessage(server);
      const result = await server.getHandler("pass_message")({
        sid: sid1, pin: pin1, message_id: event.id,
      });

      expect(isError(result)).toBe(false);
      expect(parseTool(result)).toMatchObject({ forwarded_to: sid2 });

      // sid2 now has the event; sid1 does not
      const q2items = getSessionQueue(sid2)!.dequeueBatch();
      expect(q2items).toHaveLength(1);
      expect(q2items[0].id).toBe(event.id);
    });

    it("pass_message fails when last session has nowhere to pass", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      // only one session — no next session in cascade
      setRoutingMode("cascade");

      const event = makeEvent();
      mockGetMessage.mockReturnValue(event);

      const server = createMockServer();
      registerPassMessage(server);
      const result = await server.getHandler("pass_message")({
        sid: sid1, pin: pin1, message_id: event.id,
      });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("PASS_FAILED");
    });

    it("pass_message fails outside cascade mode", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      // default routing: load_balance

      const event = makeEvent();
      mockGetMessage.mockReturnValue(event);

      const server = createMockServer();
      registerPassMessage(server);
      const result = await server.getHandler("pass_message")({
        sid: sid1, pin: pin1, message_id: event.id,
      });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("NOT_CASCADE_MODE");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Load-balance queue independence
  // -------------------------------------------------------------------------
  describe("scenario 8: load-balance queue independence", () => {
    it("messages enqueued to different sessions are received independently", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      const e1 = makeEvent({ content: { type: "text", text: "for session 1" } });
      const e2 = makeEvent({ content: { type: "text", text: "for session 2" } });
      getSessionQueue(sid1)!.enqueueMessage(e1);
      getSessionQueue(sid2)!.enqueueMessage(e2);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1 = await dequeue({ timeout: 0, sid: sid1 });
      const r2 = await dequeue({ timeout: 0, sid: sid2 });

      const updates1 = parseTool(r1).updates as { content: { text: string } }[];
      const updates2 = parseTool(r2).updates as { content: { text: string } }[];

      expect(updates1[0].content.text).toBe("for session 1");
      expect(updates2[0].content.text).toBe("for session 2");
    });

    it("three messages enqueued round-robin arrive at the correct sessions", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);

      // Enqueue two to sid1, one to sid2
      const a = makeEvent({ content: { type: "text", text: "a" } });
      const b = makeEvent({ content: { type: "text", text: "b" } });
      const c = makeEvent({ content: { type: "text", text: "c" } });
      getSessionQueue(sid1)!.enqueueMessage(a);
      getSessionQueue(sid1)!.enqueueMessage(b);
      getSessionQueue(sid2)!.enqueueMessage(c);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1a = await dequeue({ timeout: 0, sid: sid1 });
      const r1b = await dequeue({ timeout: 0, sid: sid1 });
      const r2  = await dequeue({ timeout: 0, sid: sid2 });

      const text = (r: unknown) =>
        (parseTool(r).updates as { content: { text: string } }[])[0].content.text;

      expect(text(r1a)).toBe("a");
      expect(text(r1b)).toBe("b");
      expect(text(r2)).toBe("c");
    });
  });
});
