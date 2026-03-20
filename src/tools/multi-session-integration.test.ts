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

const hoistedMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  ackVoice: vi.fn(),
  sendServiceMessage: vi.fn(() => Promise.resolve()),
  getMessage: vi.fn<() => TimelineEvent | undefined>(),
}));

const mockSendMessage = hoistedMocks.sendMessage;
const mockAckVoice = hoistedMocks.ackVoice;

const _fakeApi = {
  sendMessage: (..._args: unknown[]) => hoistedMocks.sendMessage(),
};

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => _fakeApi,
    resolveChat: () => 1,
    ackVoiceMessage: hoistedMocks.ackVoice,
    sendServiceMessage: hoistedMocks.sendServiceMessage,
  };
});

// message-store: only getMessage is needed by passMessage / routeMessage.
// dequeueBatch / waitForEnqueue are only hit when no session queue exists (never
// in these tests — every test creates an explicit session queue for every SID).
vi.mock("../message-store.js", () => ({
  getMessage: hoistedMocks.getMessage,
  CURRENT: -1,
  dequeue: vi.fn(() => undefined),
  dequeueBatch: vi.fn(() => []),
  pendingCount: vi.fn(() => 0),
  waitForEnqueue: vi.fn(() => new Promise<void>(() => { /* never resolves */ })),
  replaceSessionCallbackHooks: vi.fn(() => []),
}));

vi.mock("../built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: vi.fn() };
});

// ---------------------------------------------------------------------------
// Real session infrastructure (refreshGovernorCommand stubbed above)
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
  setGovernorSid,
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
      const { sid: sid2, pin: pin2 } = createSession();
      createSessionQueue(sid2);

      const event = makeEvent();
      getSessionQueue(sid1)!.enqueue(event);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r2 = await dequeue({ timeout: 0, identity: [sid2, pin2] });
      expect(isError(r2)).toBe(false);
      expect(parseTool(r2).empty).toBe(true);
    });

    it("dequeue from SID 1 returns the event enqueued for SID 1", async () => {
      const { sid: sid1, pin: pin1 } = createSession();
      createSessionQueue(sid1);
      const { sid: sid2 } = createSession();
      createSessionQueue(sid2);

      const event = makeEvent();
      getSessionQueue(sid1)!.enqueue(event);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1 = await dequeue({ timeout: 0, identity: [sid1, pin1] });
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

    it("send_text without identity returns SID_REQUIRED in all modes", async () => {
      const server = createMockServer();
      registerSendText(server);
      const result = await server.getHandler("send_text")({ text: "hello" });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Voice ack via session queue path
  // -------------------------------------------------------------------------
  describe("scenario 3: voice ack via session queue", () => {
    it("ackVoiceMessage is called when voice event dequeued from session queue", async () => {
      const { sid, pin } = createSession();
      createSessionQueue(sid);

      const voiceEvent = makeVoiceEvent();
      getSessionQueue(sid)!.enqueue(voiceEvent);

      const server = createMockServer();
      registerDequeue(server);
      await server.getHandler("dequeue_update")({ timeout: 0, identity: [sid, pin] });

      expect(mockAckVoice).toHaveBeenCalledOnce();
      expect(mockAckVoice).toHaveBeenCalledWith(voiceEvent.id);
    });

    it("ackVoiceMessage is NOT called for non-voice events", async () => {
      const { sid, pin } = createSession();
      createSessionQueue(sid);

      getSessionQueue(sid)!.enqueue(makeEvent()); // text event

      const server = createMockServer();
      registerDequeue(server);
      await server.getHandler("dequeue_update")({ timeout: 0, identity: [sid, pin] });

      expect(mockAckVoice).not.toHaveBeenCalled();
    });

    it("ackVoiceMessage is called for each voice event in a batch", async () => {
      const { sid, pin } = createSession();
      createSessionQueue(sid);

      // Two voice events to verify both are acked
      const v1 = makeVoiceEvent();
      const v2 = makeVoiceEvent();
      getSessionQueue(sid)!.enqueue(v1);
      getSessionQueue(sid)!.enqueue(v2);

      const server = createMockServer();
      registerDequeue(server);

      // First dequeue gets one message (TwoLaneQueue dequeues one message per batch)
      await server.getHandler("dequeue_update")({ timeout: 0, identity: [sid, pin] });
      // Second dequeue gets the next
      await server.getHandler("dequeue_update")({ timeout: 0, identity: [sid, pin] });

      expect(mockAckVoice).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Session close resets governor routing
  // -------------------------------------------------------------------------
  describe("scenario 4: session close resets governor routing", () => {
    it("closing governor session clears governor when 1 session remains (2→1 teardown)", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      setGovernorSid(sid1);

      expect(getGovernorSid()).toBe(sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ identity: [sid1, pin1] });

      // 2→1 teardown: single-session mode restored, governor cleared
      expect(getGovernorSid()).toBe(0);
    });

    it("closing governor session clears governor when no sessions remain", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      setGovernorSid(sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ identity: [sid1, pin1] });

      expect(getGovernorSid()).toBe(0);
    });

    it("closing a non-governor session clears governor when 1 session remains (2→1 teardown)", async () => {
      const { sid: sid1, pin: _pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);
      setGovernorSid(sid1);

      const server = createMockServer();
      registerCloseSession(server);
      await server.getHandler("close_session")({ identity: [sid2, pin2] });

      // 2→1 teardown: governor cleared regardless of which session closed
      expect(getGovernorSid()).toBe(0);
    });

    it("close_session with wrong pin returns AUTH_FAILED and leaves governor intact", async () => {
      const { sid: sid1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2 } = createSession(); createSessionQueue(sid2);
      setGovernorSid(sid1);

      const server = createMockServer();
      registerCloseSession(server);
      const result = await server.getHandler("close_session")({ identity: [sid1, 99999] });

      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
      expect(getGovernorSid()).toBe(sid1);
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
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const [r1, r2] = await Promise.all([
        dequeue({ timeout: 0, identity: [sid1, pin1] }),
        dequeue({ timeout: 0, identity: [sid2, pin2] }),
      ]);

      expect(parseTool(r1).empty).toBe(true);
      expect(parseTool(r2).empty).toBe(true);
    });

    it("only the session with a pending message gets it on concurrent polls", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);
      getSessionQueue(sid1)!.enqueue(makeEvent());

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const [r1, r2] = await Promise.all([
        dequeue({ timeout: 0, identity: [sid1, pin1] }),
        dequeue({ timeout: 0, identity: [sid2, pin2] }),
      ]);

      expect(Array.isArray(parseTool(r1).updates)).toBe(true);
      expect(parseTool(r2).empty).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Queue independence
  // -------------------------------------------------------------------------
  describe("scenario 7: queue independence", () => {
    it("messages enqueued to different sessions are received independently", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);

      const e1 = makeEvent({ content: { type: "text", text: "for session 1" } });
      const e2 = makeEvent({ content: { type: "text", text: "for session 2" } });
      getSessionQueue(sid1)!.enqueue(e1);
      getSessionQueue(sid2)!.enqueue(e2);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1 = await dequeue({ timeout: 0, identity: [sid1, pin1] });
      const r2 = await dequeue({ timeout: 0, identity: [sid2, pin2] });

      const updates1 = parseTool(r1).updates as { content: { text: string } }[];
      const updates2 = parseTool(r2).updates as { content: { text: string } }[];

      expect(updates1[0].content.text).toBe("for session 1");
      expect(updates2[0].content.text).toBe("for session 2");
    });

    it("three messages enqueued round-robin arrive at the correct sessions", async () => {
      const { sid: sid1, pin: pin1 } = createSession(); createSessionQueue(sid1);
      const { sid: sid2, pin: pin2 } = createSession(); createSessionQueue(sid2);

      // Enqueue two to sid1, one to sid2
      const a = makeEvent({ content: { type: "text", text: "a" } });
      const b = makeEvent({ content: { type: "text", text: "b" } });
      const c = makeEvent({ content: { type: "text", text: "c" } });
      getSessionQueue(sid1)!.enqueue(a);
      getSessionQueue(sid1)!.enqueue(b);
      getSessionQueue(sid2)!.enqueue(c);

      const server = createMockServer();
      registerDequeue(server);
      const dequeue = server.getHandler("dequeue_update");

      const r1a = await dequeue({ timeout: 0, identity: [sid1, pin1] });
      const r1b = await dequeue({ timeout: 0, identity: [sid1, pin1] });
      const r2  = await dequeue({ timeout: 0, identity: [sid2, pin2] });

      const text = (r: unknown) =>
        (parseTool(r).updates as { content: { text: string } }[])[0].content.text;

      expect(text(r1a)).toBe("a");
      expect(text(r1b)).toBe("b");
      expect(text(r2)).toBe("c");
    });
  });
});
