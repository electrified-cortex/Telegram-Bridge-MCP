/**
 * Edge-case tests for rapid button clicks and expired callback_query events.
 *
 * Tests what happens when:
 *   - The same button is clicked 2–3 times in rapid succession
 *   - answerCallbackQuery fails with "query is too old" (expired callback)
 *   - A send_choice hook is already consumed when a second click arrives
 *
 * Mocks only the Telegram HTTP transport. Uses real hook infrastructure,
 * real session queues, and real dequeue logic.
 *
 * No production code changes — test file only.
 */
import type { Update } from "grammy/types";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mock Telegram HTTP transport only — everything else is REAL
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  ackVoiceMessage: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageText: mocks.editMessageText,
      editMessageReplyMarkup: mocks.editMessageReplyMarkup,
    }),
    resolveChat: () => 42,
    ackVoiceMessage: mocks.ackVoiceMessage,
  };
});

// ---------------------------------------------------------------------------
// Real module imports — NOT mocked (this is the integration under test)
// ---------------------------------------------------------------------------

import { recordInbound, resetStoreForTest } from "../message-store.js";
import { createSession, setActiveSession, resetSessions } from "../session-manager.js";
import { createSessionQueue, resetSessionQueuesForTest } from "../session-queue.js";
import { resetRoutingModeForTest } from "../routing-mode.js";
import { resetDmPermissionsForTest } from "../dm-permissions.js";
import { runInSessionContext } from "../session-context.js";

import { register as registerConfirm } from "./confirm/handler.js";
import { register as registerChoose } from "./send/choose.js";
import { register as registerSendChoice } from "./send/choice.js";
import { register as registerDequeueUpdate } from "./dequeue.js";

// ---------------------------------------------------------------------------
// Telegram update factories
// ---------------------------------------------------------------------------

function cbUpdate(targetMsgId: number, data: string, qid = "qid1") {
  return { update_id: 0, callback_query: {
      id: qid,
      from: { id: 999, first_name: "User", is_bot: false },
      message: { message_id: targetMsgId, chat: { id: 42 } },
      chat_instance: "ci1",
      data,
    },
  } as unknown as Update;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const SENT_MSG = { message_id: 5, chat: { id: 42 }, date: 0 };

let sid: number;
let suffix: number;
let token: number;
let handlers: {
  confirm: ToolHandler;
  choose: ToolHandler;
  send_choice: ToolHandler;
  dequeue: ToolHandler;
};

describe("callback edge-cases — rapid clicks and expired queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreForTest();
    resetSessions();
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    resetDmPermissionsForTest();

    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.ackVoiceMessage.mockReturnValue(undefined);

    const session = createSession("edge-case-test");
    setActiveSession(session.sid);
    createSessionQueue(session.sid);
    sid = session.sid;
    suffix = session.suffix;
    token = sid * 1_000_000 + suffix;

    const server = createMockServer();
    registerConfirm(server);
    registerChoose(server);
    registerSendChoice(server);
    registerDequeueUpdate(server);

    handlers = {
      confirm: server.getHandler("confirm"),
      choose: server.getHandler("choose"),
      send_choice: server.getHandler("send_choice"),
      dequeue: server.getHandler("dequeue"),
    };
  });

  // -------------------------------------------------------------------------
  // SC-1: Double click on confirm — second callback ignored gracefully
  // -------------------------------------------------------------------------

  it("SC-1: second callback_query on confirm is ignored — no crash, confirm resolves once", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.confirm({ text: "Proceed?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // First click — hook fires, message edited, buttons removed
    recordInbound(cbUpdate(5, "confirm_yes", "qid1"));
    const result = await toolPromise;

    // Second click (same message_id, different query_id) — arrives after confirm resolved
    recordInbound(cbUpdate(5, "confirm_yes", "qid2"));
    await new Promise<void>((r) => { setTimeout(r, 20); });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).confirmed).toBe(true);

    // answerCallbackQuery called exactly once — only the first press acked by the hook
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");

    // Message edited exactly once
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // SC-2: Triple rapid click on choose — only first fires hook
  // -------------------------------------------------------------------------

  it("SC-2: triple rapid click on choose — only first click acks and edits, choose resolves once", async () => {
    const opts = [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
      { label: "Gamma", value: "c" },
    ];
    const toolPromise = runInSessionContext(sid, () =>
      handlers.choose({ text: "Pick one:", options: opts, ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Three rapid clicks on the same button — all arrive before choose processes them
    recordInbound(cbUpdate(5, "b", "qid1"));
    recordInbound(cbUpdate(5, "b", "qid2"));
    recordInbound(cbUpdate(5, "b", "qid3"));

    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    expect(parseResult(result).value).toBe("b");
    expect(parseResult(result).label).toBe("Beta");

    // Hook is one-shot — acked and keyboard edited only once
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // SC-3: Expired callback — answerCallbackQuery fails gracefully
  // -------------------------------------------------------------------------

  it("SC-3: answerCallbackQuery throws 'query is too old' — error swallowed, confirm still resolves", async () => {
    mocks.answerCallbackQuery.mockRejectedValue(
      new Error("query is too old and response timeout expired"),
    );

    const toolPromise = runInSessionContext(sid, () =>
      handlers.confirm({ text: "Still there?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(cbUpdate(5, "confirm_yes", "qid1"));
    const result = await toolPromise;

    // Give ackAndEditSelection (fire-and-forget from hook) time to complete
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // No crash despite answerCallbackQuery failing
    expect(isError(result)).toBe(false);
    expect(parseResult(result).confirmed).toBe(true);

    // answerCallbackQuery was attempted
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");

    // editMessageText was still called — edit is independent of the ack
    expect(mocks.editMessageText).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-4p: send_choice persistent — second click still fires hook (multi-tap)
  // -------------------------------------------------------------------------

  it("SC-4p: send_choice persistent mode — second tap fires hook again (multi-tap works)", async () => {
    const sendResult = await runInSessionContext(sid, () =>
      handlers.send_choice({
        text: "Control panel:",
        options: [{ label: "Option A", value: "a" }, { label: "Option B", value: "b" }],
        persistent: true,
        token,
      }),
    );
    expect(isError(sendResult)).toBe(false);
    expect(parseResult(sendResult).message_id).toBe(5);

    // First press — hook fires ackAndEditSelection (keyboard stays visible with highlight)
    recordInbound(cbUpdate(5, "a", "qid1"));
    await new Promise<void>((r) => { setTimeout(r, 20); });

    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    // No keyboard collapse in persistent mode
    expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();

    // Second press — hook must still be alive (persistent registration)
    recordInbound(cbUpdate(5, "b", "qid2"));
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Hook fired again: both presses acked and keyboard updated
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(2);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid2");
    expect(mocks.editMessageText).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // SC-4: send_choice — second click after hook consumed
  // -------------------------------------------------------------------------

  it("SC-4: send_choice second click after hook consumed — keyboard only removed once, second callback queues for dequeue", async () => {
    vi.useFakeTimers();

    const sendResult = await runInSessionContext(sid, () =>
      handlers.send_choice({
        text: "Pick an option:",
        options: [{ label: "Option A", value: "a" }, { label: "Option B", value: "b" }],
        token,
      }),
    );
    expect(isError(sendResult)).toBe(false);
    expect(parseResult(sendResult).message_id).toBe(5);

    // First click — one-shot hook fires two-stage highlight-then-collapse:
    // stage 1 (immediate): answerCallbackQuery + editMessageReplyMarkup with highlight
    // stage 2 (~150 ms later): editMessageText with empty keyboard + selection suffix
    recordInbound(cbUpdate(5, "a", "qid1"));
    // Flush microtasks for stage 1
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    // Stage 1 complete: editMessageReplyMarkup called with highlighted keyboard
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    // Stage 2 not yet: timer hasn't fired
    expect(mocks.editMessageText).not.toHaveBeenCalled();

    // Advance past collapse delay (150 ms) — stage 2 fires
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);

    // Second click — hook already consumed; no additional ack or keyboard removal
    recordInbound(cbUpdate(5, "a", "qid2"));
    await vi.advanceTimersByTimeAsync(200);

    // Keyboard NOT removed a second time
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    // answerCallbackQuery NOT called again (no hook to fire it)
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    // Flush microtasks from fake-timer resolution before proceeding
    await Promise.resolve();
    await Promise.resolve();

    // Both callbacks appear in dequeue — both were routed to the session queue
    const dqResult = await runInSessionContext(sid, () =>
      handlers.dequeue({ timeout: 0, token }),
    );
    expect(isError(dqResult)).toBe(false);
    const dq = parseResult(dqResult);
    const updates = dq.updates as Record<string, unknown>[];
    expect(Array.isArray(updates)).toBe(true);

    const cbEvents = updates.filter((e) => e.event === "callback");
    const qids = cbEvents.map((e) => (e.content as Record<string, unknown>).qid);
    // Both clicks are present in the queue for the agent to process
    expect(qids).toContain("qid1");
    expect(qids).toContain("qid2");
  });
});
