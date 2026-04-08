/**
 * End-to-end interactive flow integration tests.
 *
 * Wires together real session queues, real callback hooks, and real dequeue
 * logic — mocking only the Telegram HTTP API calls. Proves the full
 * round-trip for each interactive tool from message send through user
 * interaction back to the resolved tool result.
 *
 * No production code changes — test file only.
 */
import type { Update } from "grammy/types";
import { vi, describe, it, expect, beforeEach } from "vitest";
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

import { register as registerConfirm } from "./confirm.js";
import { register as registerChoose } from "./choose.js";
import { register as registerAsk } from "./ask.js";
import { register as registerSendChoice } from "./send_choice.js";
import { register as registerDequeueUpdate } from "./dequeue_update.js";

// ---------------------------------------------------------------------------
// Telegram update factories
// ---------------------------------------------------------------------------

let _nextId = 100; // inbound message IDs — must be > bot's sent message_id (5)

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

function textUpdate(text: string) {
  const msgId = _nextId++;
  return {
    update_id: 0,
    message: {
      message_id: msgId,
      from: { id: 999, first_name: "User", is_bot: false },
      chat: { id: 42, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  } as unknown as Update;
}

function voiceUpdate() {
  const msgId = _nextId++;
  return {
    update_id: 0,
    message: {
      message_id: msgId,
      from: { id: 999, first_name: "User", is_bot: false },
      chat: { id: 42, type: "private" },
      date: Math.floor(Date.now() / 1000),
      voice: { file_id: "v_test", file_unique_id: "vu1", duration: 2 },
    },
  } as unknown as Update;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const SENT_MSG = { message_id: 5, chat: { id: 42 }, date: 0 };

let sid: number;
let pin: number;
let token: number;
let handlers: {
  confirm: ToolHandler;
  choose: ToolHandler;
  ask: ToolHandler;
  send_choice: ToolHandler;
  dequeue_update: ToolHandler;
};

describe("interactive flows — end-to-end integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreForTest();
    resetSessions();
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    resetDmPermissionsForTest();
    _nextId = 100;

    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
    mocks.ackVoiceMessage.mockReturnValue(undefined);

    const session = createSession("integration-test");
    setActiveSession(session.sid);
    createSessionQueue(session.sid);
    sid = session.sid;
    pin = session.pin;
    token = sid * 1_000_000 + pin;

    const server = createMockServer();
    registerConfirm(server);
    registerChoose(server);
    registerAsk(server);
    registerSendChoice(server);
    registerDequeueUpdate(server);

    handlers = {
      confirm: server.getHandler("confirm"),
      choose: server.getHandler("choose"),
      ask: server.getHandler("ask"),
      send_choice: server.getHandler("send_choice"),
      dequeue_update: server.getHandler("dequeue_update"),
    };
  });

  // -------------------------------------------------------------------------
  // SC-1: confirm round-trip
  // -------------------------------------------------------------------------

  it("SC-1a: confirm resolves confirmed:true when user presses Yes", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.confirm({ text: "Proceed?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(cbUpdate(5, "confirm_yes"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.confirmed).toBe(true);
    expect(data.value).toBe("confirm_yes");
    expect(data.message_id).toBe(5);
    // Hook fired: ackAndEditSelection called answerCallbackQuery + editMessageText
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageText).toHaveBeenCalled();
  });

  it("SC-1b: confirm resolves confirmed:false when user presses No", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.confirm({ text: "Delete everything?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(cbUpdate(5, "confirm_no"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.confirmed).toBe(false);
    expect(data.value).toBe("confirm_no");
  });

  // -------------------------------------------------------------------------
  // SC-2: choose round-trip
  // -------------------------------------------------------------------------

  it("SC-2: choose resolves with the label and value of the pressed button", async () => {
    const opts = [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
      { label: "Gamma", value: "c" },
    ];
    const toolPromise = runInSessionContext(sid, () =>
      handlers.choose({ text: "Pick one:", options: opts, ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(cbUpdate(5, "b"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.label).toBe("Beta");
    expect(data.value).toBe("b");
    expect(data.message_id).toBe(5);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageText).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-3: ask text round-trip
  // -------------------------------------------------------------------------

  it("SC-3: ask resolves with the user's text reply", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.ask({ question: "What is your name?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(textUpdate("Alice"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("Alice");
    expect(data.voice).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // SC-4: ask voice round-trip
  // -------------------------------------------------------------------------

  it("SC-4: ask resolves with transcribed voice text and acks the voice message", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.ask({ question: "Tell me something", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // recordInbound accepts an optional transcribedText for voice messages
    recordInbound(voiceUpdate(), "this is transcribed");
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("this is transcribed");
    expect(data.voice).toBe(true);
    expect(mocks.ackVoiceMessage).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-5: send_choice callback → auto-locked → event in dequeue_update
  // -------------------------------------------------------------------------

  it("SC-5: send_choice auto-locks on first press and callback appears in dequeue_update", async () => {
    const sendResult = await runInSessionContext(sid, () =>
      handlers.send_choice({
        text: "Choose:",
        options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
        token,
      }),
    );
    expect(isError(sendResult)).toBe(false);
    expect(parseResult(sendResult).message_id).toBe(5);

    // Simulate button press — hook fires (ack + remove keyboard), event queues
    recordInbound(cbUpdate(5, "yes"));

    // dequeue_update should surface the callback event
    const dqResult = await handlers.dequeue_update({ timeout: 0, token });
    // Allow the fire-and-forget hook chain (answerCallbackQuery → editMessageReplyMarkup)
    // to complete — it needs one extra microtask tick after dequeue_update resolves.
    await Promise.resolve();

    expect(isError(dqResult)).toBe(false);
    const dq = parseResult(dqResult);
    const updates = dq.updates as unknown[];
    expect(Array.isArray(updates)).toBe(true);
    expect(updates.length).toBeGreaterThan(0);

    const firstEvt = updates[0] as Record<string, unknown>;
    expect(firstEvt.event).toBe("callback");
    const content = firstEvt.content as Record<string, unknown>;
    expect(content.data).toBe("yes");

    // Hook fired — keyboard removed and callback answered
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid1");
    expect(mocks.editMessageReplyMarkup).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-6: confirm timeout then late click still fires hook
  // -------------------------------------------------------------------------

  it("SC-6: late callback after confirm timeout still fires the hook and appears in dequeue_update", async () => {
    const confirmResult = await runInSessionContext(sid, () =>
      handlers.confirm({ text: "Time-sensitive?", timeout_seconds: 1, ignore_pending: true, token }),
    );
    expect(isError(confirmResult)).toBe(false);
    expect(parseResult(confirmResult).timed_out).toBe(true);

    // Callback hook is still registered after timeout — late clicks are handled
    const ackCallsBefore = mocks.answerCallbackQuery.mock.calls.length;
    recordInbound(cbUpdate(5, "confirm_yes", "qid_late"));

    // dequeue_update surfaces the event; an extra yield lets the hook's
    // fire-and-forget chain (answerCallbackQuery → editMessageText) complete.
    const dqResult = await handlers.dequeue_update({ timeout: 0, token });
    await Promise.resolve();

    expect(mocks.answerCallbackQuery.mock.calls.length).toBeGreaterThan(ackCallsBefore);
    expect(mocks.editMessageText).toHaveBeenCalled();

    const dq = parseResult(dqResult);
    const updates = dq.updates as unknown[];
    expect(updates.length).toBeGreaterThan(0);
    const firstEvt = updates[0] as Record<string, unknown>;
    expect(firstEvt.event).toBe("callback");
  });

  // -------------------------------------------------------------------------
  // SC-7: choose voice interruption
  // -------------------------------------------------------------------------

  it("SC-7: choose returns skipped+voice when user sends a transcribed voice message", async () => {
    const opts = [{ label: "A", value: "a" }, { label: "B", value: "b" }];
    const toolPromise = runInSessionContext(sid, () =>
      handlers.choose({ text: "A or B?", options: opts, ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(voiceUpdate(), "I prefer A actually");
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.voice).toBe(true);
    expect(data.text_response).toBe("I prefer A actually");
    // Keyboard edited to show "Skipped"
    expect(mocks.editMessageText).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-8: confirm text interruption
  // -------------------------------------------------------------------------

  it("SC-8: confirm returns skipped+text when user sends a text message instead of pressing a button", async () => {
    const toolPromise = runInSessionContext(sid, () =>
      handlers.confirm({ text: "Go ahead?", ignore_pending: true, token }),
    );
    await new Promise<void>((r) => { setTimeout(r, 20); });

    recordInbound(textUpdate("Actually never mind"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("Actually never mind");
    // Original buttons edited to show "Skipped"
    expect(mocks.editMessageText).toHaveBeenCalled();
  });
});
