/**
 * AC8 — Integration regression test:
 *   createSession() → closeSessionById() → handleSessionReconnect(connectionToken)
 *   → assert CALLER_CLOSED (not SESSION_NOT_FOUND or operator dialog).
 *
 * This test exercises the full teardown path (session-teardown.ts →
 * session-manager.ts → recordClosedMarker) rather than the unit-test path that
 * mocks session-manager and stubs isClosedMarker directly.
 *
 * Key: both closeSessionById() and handleSessionReconnect() share the real
 * session-manager module so the marker written by closeSession() is visible to
 * the subsequent isClosedMarker() check.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TimelineEvent } from "../../message-store.js";
import { isError, errorCode } from "../test-utils.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Only the Telegram network layer and ancillary services are mocked.
// session-manager is intentionally left real so the closed-marker store is live.

const hoisted = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendServiceMessage: vi.fn().mockResolvedValue(undefined),
  unpinChatMessage: vi.fn().mockResolvedValue(undefined),
  pinChatMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  resolveChat: vi.fn(() => 42),
  replaceSessionCallbackHooks: vi.fn().mockReturnValue([]),
  refreshGovernorCommand: vi.fn(),
  stopPoller: vi.fn(),
  startPoller: vi.fn(),
  isPollerRunning: vi.fn().mockReturnValue(false),
  readProfile: vi.fn((_key: string): Record<string, unknown> | null => null),
  applyProfile: vi.fn((_sid: number, _profile: unknown) => ({ applied: {} })),
  resetNotifyGateState: vi.fn(),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: hoisted.sendMessage,
      sendServiceMessage: hoisted.sendServiceMessage,
      unpinChatMessage: hoisted.unpinChatMessage,
      pinChatMessage: hoisted.pinChatMessage,
      deleteMessage: hoisted.deleteMessage,
      editMessageText: hoisted.editMessageText,
      editMessageReplyMarkup: hoisted.editMessageReplyMarkup,
      answerCallbackQuery: hoisted.answerCallbackQuery,
    }),
    resolveChat: () => hoisted.resolveChat(),
    sendServiceMessage: hoisted.sendServiceMessage,
  };
});

vi.mock("../../message-store.js", () => ({
  CURRENT: -1,
  dequeue: vi.fn(() => undefined),
  dequeueBatch: vi.fn(() => []),
  pendingCount: vi.fn(() => 0),
  waitForEnqueue: vi.fn(() => new Promise<void>(() => { /* never resolves */ })),
  replaceSessionCallbackHooks: (...args: unknown[]) => hoisted.replaceSessionCallbackHooks(...args),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  recordOutgoing: vi.fn(),
}));

vi.mock("../../built-in-commands.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, refreshGovernorCommand: hoisted.refreshGovernorCommand };
});

vi.mock("../../poller.js", () => ({
  startPoller: (...args: unknown[]) => hoisted.startPoller(...args),
  stopPoller: () => hoisted.stopPoller(),
  isPollerRunning: () => hoisted.isPollerRunning(),
}));

vi.mock("../../profile-store.js", () => ({
  readProfile: (key: string) => hoisted.readProfile(key),
}));

vi.mock("../profile/apply.js", () => ({
  applyProfile: (sid: number, profile: unknown) => hoisted.applyProfile(sid, profile),
}));

vi.mock("../activity/file-state.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Explicitly declare isDequeueActive so Vitest's module proxy registers
    // it as a valid named export (spread alone may not enumerate namespace exports).
    isDequeueActive: vi.fn().mockReturnValue(false),
    resetNotifyGateState: (...args: unknown[]) => hoisted.resetNotifyGateState(...args),
    clearActivityFile: vi.fn().mockResolvedValue(undefined),
  };
});

// ─── Real session infrastructure (intentionally NOT mocked) ──────────────────

import {
  createSession,
  resetSessions,
  isClosedMarker,
} from "../../session-manager.js";
import {
  createSessionQueue,
  resetSessionQueuesForTest,
} from "../../session-queue.js";
import {
  setGovernorSid,
  resetRoutingModeForTest,
} from "../../routing-mode.js";
import { resetDmPermissionsForTest } from "../../dm-permissions.js";

// Dynamic import after mocks are registered so the modules see hoisted stubs.
const { closeSessionById } = await import("../../session-teardown.js");
const { handleSessionReconnect } = await import("./start.js");

// ─── State reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetSessions();
  resetSessionQueuesForTest();
  resetRoutingModeForTest();
  resetDmPermissionsForTest();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AC8 — closeSessionById() teardown path marks connectionToken", () => {
  it("closeSessionById records a closed marker for the session's connectionToken", () => {
    const session = createSession("Worker");
    createSessionQueue(session.sid);
    setGovernorSid(session.sid);

    const { connectionToken } = session;
    expect(isClosedMarker(connectionToken)).toBe(false); // not yet closed

    closeSessionById(session.sid);

    expect(isClosedMarker(connectionToken)).toBe(true); // marker recorded
  });

  it("handleSessionReconnect returns CALLER_CLOSED when connectionToken has a closed marker (full teardown path)", async () => {
    // Set up: two sessions so teardown doesn't clear the governor entirely
    const govSession = createSession("Governor");
    createSessionQueue(govSession.sid);
    setGovernorSid(govSession.sid);

    const workerSession = createSession("Worker");
    createSessionQueue(workerSession.sid);

    const closedToken = workerSession.connectionToken;

    // Full teardown path — this is what closeSession() (internal) does NOT do alone
    closeSessionById(workerSession.sid);

    // Verify the marker was recorded by the real teardown path
    expect(isClosedMarker(closedToken)).toBe(true);

    // Now attempt to reconnect using the closed connectionToken
    const result = await handleSessionReconnect({
      name: "Worker",
      connection_token: closedToken,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLER_CLOSED");

    // Operator dialog must NOT have been shown
    expect(hoisted.sendMessage).not.toHaveBeenCalled();
  });

  it("CALLER_CLOSED is returned before any approval dialog even if a live session with the same name exists", async () => {
    // Edge case: closed token is presented but a NEW session with the same name
    // was started in the meantime — rejection must still be CALLER_CLOSED.
    const first = createSession("Worker");
    createSessionQueue(first.sid);
    setGovernorSid(first.sid);

    const closedToken = first.connectionToken;
    closeSessionById(first.sid);

    // Start a fresh session with the same name (different connectionToken)
    const second = createSession("Worker");
    createSessionQueue(second.sid);
    setGovernorSid(second.sid);

    const result = await handleSessionReconnect({
      name: "Worker",
      connection_token: closedToken,
    });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLER_CLOSED");
    expect(hoisted.sendMessage).not.toHaveBeenCalled();
  });

  it("reconnect proceeds normally when connectionToken is from a session that is still live (not closed)", async () => {
    const govSession = createSession("Governor");
    createSessionQueue(govSession.sid);
    setGovernorSid(govSession.sid);

    const workerSession = createSession("Worker");
    createSessionQueue(workerSession.sid);

    const liveToken = workerSession.connectionToken;
    // Do NOT call closeSessionById — session remains live

    // Reconnect should NOT be rejected with CALLER_CLOSED
    // (it will proceed to the reconnect approval dialog — we deny for simplicity)
    hoisted.sendMessage.mockResolvedValueOnce({ message_id: 99 });
    // Simulate operator denial via callback hook after a microtask.
    // Cast through unknown to avoid CallbackHookFn type constraints in the mock.
    const { registerCallbackHook } = await import("../../message-store.js");
    (vi.mocked(registerCallbackHook) as unknown as { mockImplementationOnce: (fn: unknown) => void })
      .mockImplementationOnce((_id: number, fn: (evt: TimelineEvent) => void) => {
        void Promise.resolve().then(() =>
          { fn({ content: { data: "reconnect_no", qid: "q1" } } as unknown as TimelineEvent); },
        );
      });

    const result = await handleSessionReconnect({
      name: "Worker",
      connection_token: liveToken,
    });

    // Should be SESSION_DENIED (operator denied reconnect), NOT CALLER_CLOSED
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SESSION_DENIED");
    expect(hoisted.sendMessage).toHaveBeenCalled(); // dialog was shown
  });
});
