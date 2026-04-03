/**
 * Multi-session callback isolation integration tests.
 *
 * Verifies that callback hooks and queue routing work correctly when multiple
 * sessions are active simultaneously:
 *
 *   SC-1: Callback routes to the sending session's hook when 2 sessions exist
 *   SC-2: Concurrent buttons from different sessions — hooks are independent
 *   SC-3: Session close replaces in-flight hooks with a graceful "Session closed" handler
 *   SC-4: Governor routing — button callback goes to the session that owns the message,
 *         not the governor
 *
 * Mocks only the Telegram HTTP transport. Uses real session queues, real hooks,
 * and real routing logic.
 *
 * No production code changes — test file only.
 */
import type { Update } from "grammy/types";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./tools/test-utils.js";

// ---------------------------------------------------------------------------
// Mock Telegram HTTP transport only — everything else is REAL
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  ackVoiceMessage: vi.fn(),
  sendServiceMessage: vi.fn(),
}));

vi.mock("./telegram.js", async (importActual) => {
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
    sendServiceMessage: mocks.sendServiceMessage,
  };
});

vi.mock("./built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: vi.fn() };
});

// ---------------------------------------------------------------------------
// Real module imports — only refreshGovernorCommand is stubbed above
// ---------------------------------------------------------------------------

import {
  recordInbound,
  resetStoreForTest,
  registerCallbackHook,
} from "./message-store.js";
import { createSession, setActiveSession, resetSessions } from "./session-manager.js";
import {
  createSessionQueue,
  resetSessionQueuesForTest,
  trackMessageOwner,
  getSessionQueue,
} from "./session-queue.js";
import { resetRoutingModeForTest, setGovernorSid } from "./routing-mode.js";
import { resetDmPermissionsForTest } from "./dm-permissions.js";
import { runInSessionContext, getCallerSid } from "./session-context.js";

import { register as registerConfirm } from "./tools/confirm.js";
import { register as registerChoose } from "./tools/choose.js";
import { register as registerCloseSession } from "./tools/close_session.js";
import { register as registerDequeueUpdate } from "./tools/dequeue_update.js";

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

let sid1: number;
let pin1: number;
let token1: number;
let sid2: number;
let pin2: number;
let token2: number;
let handlers: {
  confirm: ToolHandler;
  choose: ToolHandler;
  close_session: ToolHandler;
  dequeue_update: ToolHandler;
};

describe("multi-session callback isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreForTest();
    resetSessions();
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    resetDmPermissionsForTest();

    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.ackVoiceMessage.mockReturnValue(undefined);
    mocks.sendServiceMessage.mockResolvedValue(undefined);

    const session1 = createSession("Alpha");
    const session2 = createSession("Beta");
    sid1 = session1.sid;
    pin1 = session1.pin;
    token1 = sid1 * 1_000_000 + pin1;
    sid2 = session2.sid;
    pin2 = session2.pin;
    token2 = sid2 * 1_000_000 + pin2;
    setActiveSession(sid1);
    createSessionQueue(sid1);
    createSessionQueue(sid2);

    const server = createMockServer();
    registerConfirm(server);
    registerChoose(server);
    registerCloseSession(server);
    registerDequeueUpdate(server);

    handlers = {
      confirm: server.getHandler("confirm"),
      choose: server.getHandler("choose"),
      close_session: server.getHandler("close_session"),
      dequeue_update: server.getHandler("dequeue_update"),
    };
  });

  // -------------------------------------------------------------------------
  // SC-1: Callback routes to sending session's hook with 2 sessions active
  // -------------------------------------------------------------------------

  it("SC-1: with 2 sessions active, callback hook for SID1's message fires exactly once", async () => {
    // SID1 calls confirm while SID2 exists but is idle
    mocks.sendMessage.mockResolvedValue({ message_id: 5, chat: { id: 42 }, date: 0 });

    const toolPromise = runInSessionContext(sid1, () =>
      handlers.confirm({ text: "Confirm?", ignore_pending: true, token: token1 }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Callback arrives for SID1's message
    recordInbound(cbUpdate(5, "confirm_yes", "qid1"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    expect(parseResult(result).confirmed).toBe(true);

    // Hook fired exactly once — SID2's presence didn't duplicate or suppress it
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);

    // Hook was one-shot: second callback for same message triggers nothing extra
    recordInbound(cbUpdate(5, "confirm_yes", "qid2"));
    await new Promise<void>((r) => { setTimeout(r, 20); });
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // SC-2: Concurrent buttons from different sessions — hooks are independent
  // -------------------------------------------------------------------------

  it("SC-2: SID1 confirm + SID2 choose — callbacks route to the correct hook independently", async () => {
    // SID1 gets message_id 10, SID2 gets message_id 20
    mocks.sendMessage
      .mockResolvedValueOnce({ message_id: 10, chat: { id: 42 }, date: 0 }) // SID1's confirm
      .mockResolvedValueOnce({ message_id: 20, chat: { id: 42 }, date: 0 }); // SID2's choose

    const opts = [{ label: "Red", value: "red" }, { label: "Blue", value: "blue" }];

    // Start both tool calls concurrently
    const sid1Promise = runInSessionContext(sid1, () =>
      handlers.confirm({ text: "Continue?", ignore_pending: true, token: token1 }),
    );
    const sid2Promise = runInSessionContext(sid2, () =>
      handlers.choose({ question: "Pick a color:", options: opts, ignore_pending: true, token: token2 }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // SID2's button press arrives first — only SID2's hook should fire
    recordInbound(cbUpdate(20, "blue", "qid_blue"));
    const sid2Result = await sid2Promise;

    expect(isError(sid2Result)).toBe(false);
    expect(parseResult(sid2Result).value).toBe("blue");
    expect(parseResult(sid2Result).label).toBe("Blue");

    // editMessageText called once (SID2's hook)
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);

    // SID1's confirm is still waiting — hook for message 10 is still registered
    // Now fire SID1's button press
    recordInbound(cbUpdate(10, "confirm_yes", "qid_yes"));
    const sid1Result = await sid1Promise;

    expect(isError(sid1Result)).toBe(false);
    expect(parseResult(sid1Result).confirmed).toBe(true);

    // editMessageText called a second time (SID1's hook)
    expect(mocks.editMessageText).toHaveBeenCalledTimes(2);

    // Each hook acked only its own callback_query
    const ackCalls = mocks.answerCallbackQuery.mock.calls.map((c) => c[0]);
    expect(ackCalls).toContain("qid_blue");
    expect(ackCalls).toContain("qid_yes");
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // SC-3: Session close replaces in-flight hooks with "Session closed" handler
  // -------------------------------------------------------------------------

  it("SC-3: close_session replaces SID1's callback hook — late click gets graceful response", async () => {
    // Manually register a hook for SID1 (simulates an active confirm/choose)
    const hookSpy = vi.fn();
    registerCallbackHook(5, hookSpy, sid1);

    // Close SID1 — this calls replaceSessionCallbackHooks(sid1, replacementFn)
    const closeResult = await runInSessionContext(sid1, () =>
      handlers.close_session({ token: token1 }),
    );
    expect(isError(closeResult)).toBe(false);
    expect(parseResult(closeResult).closed).toBe(true);

    // Original hook was NOT called (session closed before any button press)
    expect(hookSpy).not.toHaveBeenCalled();

    // Simulate a late button press after session close
    recordInbound(cbUpdate(5, "confirm_yes", "qid_late"));
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Replacement handler fires: answers with "Session closed" text
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid_late", expect.objectContaining({ text: "Session closed" }));

    // Replacement handler also removes the inline keyboard
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
      42, 5, expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );

    // Original hook was still never called (replacement fired instead)
    expect(hookSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-4: Governor routing — button callback goes to message owner, not governor
  // -------------------------------------------------------------------------

  it("SC-4: governor session does not receive callback events targeted at another session's message", async () => {
    // Make SID1 the governor, SID2 is a standard session
    setGovernorSid(sid1);

    mocks.sendMessage.mockResolvedValue({ message_id: 99, chat: { id: 42 }, date: 0 });

    // SID2 sends a confirm (hook registered for msg 99, owned by SID2)
    const sid2ConfirmPromise = runInSessionContext(sid2, () =>
      handlers.confirm({ text: "Proceed?", ignore_pending: true, token: token2 }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Simulate the outbound proxy recording ownership (in production, the proxy does this)
    trackMessageOwner(99, sid2);

    // Fire callback for SID2's message
    recordInbound(cbUpdate(99, "confirm_yes", "qid_sid2"));
    const sid2Result = await sid2ConfirmPromise;

    expect(isError(sid2Result)).toBe(false);
    expect(parseResult(sid2Result).confirmed).toBe(true);

    // Hook fired (acked + edited) — regardless of governor routing
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid_sid2");
    expect(mocks.editMessageText).toHaveBeenCalled();

    // Governor's queue (SID1) does NOT contain the callback event —
    // it was targeted to SID2 via message ownership
    const govQueue = getSessionQueue(sid1);
    expect(govQueue).toBeDefined();
    const govEvents = govQueue!.dequeueBatch();
    const govCallbacks = govEvents.filter((e) => e.event === "callback" && e.content.target === 99);
    expect(govCallbacks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // SC-5: Callback hook fires in owning session's ALS context (regression)
  // -------------------------------------------------------------------------

  it("SC-5: callback hook runs in owning session's ALS context, not the active session's", async () => {
    // SID1 (Alpha) is the active session; hook is owned by SID2 (Beta)
    setActiveSession(sid1);

    let capturedSid = -1;
    registerCallbackHook(77, () => {
      // Inside the hook, getCallerSid should return sid2 (the owner),
      // not sid1 (the active session at the time of the callback)
      capturedSid = getCallerSid();
    }, sid2);

    // Fire callback for message 77
    recordInbound(cbUpdate(77, "some_data", "qid_ctx"));
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Without the fix, capturedSid would be sid1 (the global active session).
    // With the fix, it should be sid2 (the hook owner via runInSessionContext).
    expect(capturedSid).toBe(sid2);
  });
});
