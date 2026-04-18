/**
 * Signal abort integration tests for interactive tools.
 *
 * Verifies that the MCP AbortSignal is honoured by ask, confirm, and choose:
 *
 *   SC-1: ask resolves with { timed_out: false, aborted: true } on abort
 *   SC-2: confirm resolves with { timed_out: true } on abort during button wait
 *   SC-3: choose resolves with { timed_out: true } on abort during button wait
 *   SC-4: aborting after a result is already received does not crash
 *
 * Mocks only the Telegram HTTP transport. Uses real session queues, real
 * message store, and real polling logic.
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
  sendServiceMessage: vi.fn(),
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
    sendServiceMessage: mocks.sendServiceMessage,
  };
});

// ---------------------------------------------------------------------------
// Real module imports — NOT mocked
// ---------------------------------------------------------------------------

import {
  recordInbound,
  resetStoreForTest,
} from "../message-store.js";
import { createSession, setActiveSession, resetSessions } from "../session-manager.js";
import {
  createSessionQueue,
  resetSessionQueuesForTest,
} from "../session-queue.js";
import { resetRoutingModeForTest } from "../routing-mode.js";
import { resetDmPermissionsForTest } from "../dm-permissions.js";

import { register as registerAsk } from "./ask.js";
import { register as registerConfirm } from "./confirm.js";
import { register as registerChoose } from "./choose.js";

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

let sid: number;
let suffix: number;
let token: number;
let handlers: {
  ask: ToolHandler;
  confirm: ToolHandler;
  choose: ToolHandler;
};

describe("signal abort — interactive tools", () => {
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

    const session = createSession("Aborter");
    sid = session.sid;
    suffix = session.suffix;
    token = sid * 1_000_000 + suffix;
    setActiveSession(sid);
    createSessionQueue(sid);

    const server = createMockServer();
    registerAsk(server);
    registerConfirm(server);
    registerChoose(server);

    handlers = {
      ask: server.getHandler("ask"),
      confirm: server.getHandler("confirm"),
      choose: server.getHandler("choose"),
    };
  });

  // -------------------------------------------------------------------------
  // SC-1: ask — abort during text wait
  // -------------------------------------------------------------------------

  it("SC-1: ask resolves with aborted: true when signal fires before any reply", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 42 }, date: 0 });

    const controller = new AbortController();
    const toolPromise = handlers.ask(
      { question: "What is your name?", timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    // Wait for sendMessage to complete and the polling loop to begin
    await new Promise<void>((r) => { setTimeout(r, 20); });

    const start = Date.now();
    controller.abort();
    const result = await toolPromise;

    // Resolves promptly — not hanging until timeout
    expect(Date.now() - start).toBeLessThan(500);

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.timed_out).toBe(false);
    expect(parsed.aborted).toBe(true);
  });

  it("SC-1b: ask resolves immediately when signal is already aborted before the call", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 42 }, date: 0 });

    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const result = await handlers.ask(
      { question: "What?", timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.timed_out).toBe(false);
    expect(parsed.aborted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // SC-2: confirm — abort during button wait
  // -------------------------------------------------------------------------

  it("SC-2: confirm resolves with timed_out: true when signal fires before button press", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 20, chat: { id: 42 }, date: 0 });
    mocks.editMessageText.mockResolvedValue(undefined);

    const controller = new AbortController();
    const toolPromise = handlers.confirm(
      { text: "Continue?", timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    await new Promise<void>((r) => { setTimeout(r, 20); });

    const start = Date.now();
    controller.abort();
    const result = await toolPromise;

    // Resolves promptly — not waiting the full 60s
    expect(Date.now() - start).toBeLessThan(500);

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.timed_out).toBe(true);

    // No button was pressed — answerCallbackQuery and editMessageText were not called
    expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("SC-2b: callback hook still fires for late button press after confirm aborts", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 20, chat: { id: 42 }, date: 0 });
    mocks.editMessageText.mockResolvedValue(undefined);

    const controller = new AbortController();
    const toolPromise = handlers.confirm(
      { text: "Continue?", timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    await new Promise<void>((r) => { setTimeout(r, 20); });
    controller.abort();
    await toolPromise; // timed_out: true

    // Simulate a late button press arriving after the tool has already returned
    recordInbound(cbUpdate(20, "confirm_yes", "qid_late"));
    await new Promise<void>((r) => { setTimeout(r, 30); });

    // The callback hook (still registered) fires and acks the late click
    expect(mocks.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // SC-3: choose — abort during button wait
  // -------------------------------------------------------------------------

  it("SC-3: choose resolves with timed_out: true when signal fires before selection", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 30, chat: { id: 42 }, date: 0 });
    mocks.editMessageText.mockResolvedValue(undefined);

    const controller = new AbortController();
    const opts = [{ label: "Option A", value: "a" }, { label: "Option B", value: "b" }];

    const toolPromise = handlers.choose(
      { text: "Pick one:", options: opts, timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    await new Promise<void>((r) => { setTimeout(r, 20); });

    const start = Date.now();
    controller.abort();
    const result = await toolPromise;

    // Resolves promptly — not waiting the full 60s
    expect(Date.now() - start).toBeLessThan(500);

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.timed_out).toBe(true);

    // No selection was made
    expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC-4: Abort after result already received — no crash
  // -------------------------------------------------------------------------

  it("SC-4: aborting after confirm already received a button press does not crash", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 40, chat: { id: 42 }, date: 0 });
    mocks.editMessageText.mockResolvedValue(undefined);

    const controller = new AbortController();
    const toolPromise = handlers.confirm(
      { text: "Proceed?", timeout_seconds: 60, ignore_pending: true, token },
      { signal: controller.signal },
    );

    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Button is pressed — tool should resolve with confirmed: true
    recordInbound(cbUpdate(40, "confirm_yes", "qid_pressed"));
    const result = await toolPromise;

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.confirmed).toBe(true);

    // Now abort — tool is already resolved, this is a no-op
    expect(() => { controller.abort(); }).not.toThrow();

    // Wait a tick to ensure no async errors propagate
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // Verify the normal success path: button was acked and message was edited
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("qid_pressed");
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
  });
});
