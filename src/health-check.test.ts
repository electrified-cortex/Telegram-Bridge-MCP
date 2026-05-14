import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TimelineEvent } from "./message-store.js";

// ── Hoisted mocks ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getUnhealthySessions: vi.fn((_threshold?: number) => [] as { sid: number; name: string; createdAt: string }[]),
  markUnhealthy: vi.fn(),
  getSession: vi.fn(),
  getGovernorSid: vi.fn(() => 0),
  setGovernorSid: vi.fn(),
  deliverDirectMessage: vi.fn(() => true),
  deliverServiceMessage: vi.fn(() => true),
  sendServiceMessage: vi.fn().mockResolvedValue(undefined as number | undefined),
  resolveChat: vi.fn(() => 12345 as number | { code: string; message: string }),
  getApi: vi.fn(),
  listSessions: vi.fn(() => [] as { sid: number; name: string; createdAt: string }[]),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  dlog: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  getCallerSid: vi.fn(() => 1),
  registerOnceOnSend: vi.fn(),
  clearOnceOnSend: vi.fn(),
  getActivityFile: vi.fn((_sid: number) => undefined as { filePath: string } | undefined),
  existsSync: vi.fn((_path: string) => false),
}));

vi.mock("./session-manager.js", () => ({
  getUnhealthySessions: (threshold?: number) => mocks.getUnhealthySessions(threshold),
  markUnhealthy: mocks.markUnhealthy,
  getSession: mocks.getSession,
  listSessions: () => mocks.listSessions(),
}));

vi.mock("./routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
  setGovernorSid: mocks.setGovernorSid,
}));

vi.mock("./session-queue.js", () => ({
  deliverDirectMessage: mocks.deliverDirectMessage,
  deliverServiceMessage: mocks.deliverServiceMessage,
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    sendServiceMessage: mocks.sendServiceMessage,
    resolveChat: () => mocks.resolveChat(),
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      answerCallbackQuery: mocks.answerCallbackQuery,
    }),
    getRawApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      answerCallbackQuery: mocks.answerCallbackQuery,
      deleteMessage: mocks.deleteMessage,
    }),
  };
});

vi.mock("./outbound-proxy.js", () => ({
  registerOnceOnSend: mocks.registerOnceOnSend,
  clearOnceOnSend: mocks.clearOnceOnSend,
}));

vi.mock("./tools/activity/file-state.js", () => ({
  getActivityFile: (sid: number) => mocks.getActivityFile(sid),
}));

vi.mock("fs", () => ({
  existsSync: (path: string) => mocks.existsSync(path),
}));

vi.mock("./message-store.js", () => ({
  registerCallbackHook: mocks.registerCallbackHook,
  clearCallbackHook: mocks.clearCallbackHook,
}));

vi.mock("./debug-log.js", () => ({
  dlog: mocks.dlog,
}));

vi.mock("./session-context.js", () => ({
  getCallerSid: () => mocks.getCallerSid(),
}));

// ── Import after mocks ─────────────────────────────────────

import { _runHealthCheckNow, stopHealthCheck } from "./health-check.js";

// ── Helpers ───────────────────────────────────────────────

function makeSession(sid: number, name: string) {
  return { sid, name, createdAt: new Date().toISOString() };
}

/** Simulate a button press by calling the registered callback hook. */
function pressButton(callbackData: string): void {
  const [, fn] = mocks.registerCallbackHook.mock.calls[0] as [number, (evt: TimelineEvent) => void];
  const evt = {
    id: -1,
    timestamp: new Date().toISOString(),
    event: "callback",
    from: "user",
    content: { type: "callback_query", data: callbackData, qid: "qid123" },
  } as unknown as TimelineEvent;
  fn(evt);
}

// ── Tests ──────────────────────────────────────────────────

describe("health-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopHealthCheck(); // clears _flaggedSids and message ID maps between tests
    mocks.resolveChat.mockReturnValue(12345);
    mocks.sendMessage.mockResolvedValue({ message_id: 999 });
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.deleteMessage.mockResolvedValue(undefined);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.deliverDirectMessage.mockReturnValue(true);
    mocks.deliverServiceMessage.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.getUnhealthySessions.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([]);
    mocks.getActivityFile.mockReturnValue(undefined);
    mocks.existsSync.mockReturnValue(false);
  });

  describe("no-op when all sessions healthy", () => {
    it("sends no messages when no sessions are unhealthy", async () => {
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("non-governor unhealthy session", () => {
    it("sends a notification when a non-governor session is unresponsive", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1); // governor is sid 1, not 2
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
        expect.stringContaining("Worker"),
      );
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it("marks the session as unhealthy", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      await _runHealthCheckNow();
      expect(mocks.markUnhealthy).toHaveBeenCalledWith(2);
    });

    it("does not re-notify on subsequent checks (already flagged)", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      await _runHealthCheckNow();
      await _runHealthCheckNow(); // second tick — still unhealthy
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("governor unhealthy — with next session available", () => {
    it("sends an inline keyboard prompt to the operator", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      await _runHealthCheckNow();
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("Primary"),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
    });

    it("does not send a sendServiceMessage notification for the governor", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
    });

    it("registers a callback hook for the prompt message", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      await _runHealthCheckNow();
      expect(mocks.registerCallbackHook).toHaveBeenCalledWith(999, expect.any(Function), undefined);
    });
  });

  describe("governor unhealthy — no next session", () => {
    it("sends a fallback service message when no other session exists", async () => {
      const gov = makeSession(1, "Primary");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov]); // only the governor
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
        expect.stringContaining("no other session"),
      );
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("resolveChat failure", () => {
    it("silently skips governor prompt when resolveChat fails", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      mocks.resolveChat.mockReturnValue({ code: "NO_CHAT", message: "not configured" });
      await _runHealthCheckNow();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("operator response — reroute now", () => {
    it("calls setGovernorSid with the target sid on reroute", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      mocks.getSession.mockReturnValue(next);
      await _runHealthCheckNow();
      pressButton(`hc_reroute_now:2`);
      expect(mocks.setGovernorSid).toHaveBeenCalledWith(2);
    });

    it("delivers a DM to the new governor session", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      mocks.getSession.mockReturnValue(next);
      await _runHealthCheckNow();
      pressButton(`hc_reroute_now:2`);
      expect(mocks.deliverDirectMessage).toHaveBeenCalledWith(
        0,
        2,
        expect.stringContaining("primary session"),
      );
    });

    it("edits the prompt message to confirm reroute", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      mocks.getSession.mockReturnValue(next);
      await _runHealthCheckNow();
      pressButton(`hc_reroute_now:2`);
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        12345,
        999,
        expect.any(String),
        expect.anything(),
      );
    });
  });

  describe("operator response — make primary", () => {
    it("calls setGovernorSid on make-primary", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      mocks.getSession.mockReturnValue(next);
      await _runHealthCheckNow();
      pressButton(`hc_make_primary:2`);
      expect(mocks.setGovernorSid).toHaveBeenCalledWith(2);
    });
  });

  describe("operator response — wait", () => {
    it("does not call setGovernorSid when operator chooses wait", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      await _runHealthCheckNow();
      pressButton("hc_wait");
      expect(mocks.setGovernorSid).not.toHaveBeenCalled();
    });

    it("edits the prompt message to confirm wait", async () => {
      const gov = makeSession(1, "Primary");
      const next = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, next]);
      await _runHealthCheckNow();
      pressButton("hc_wait");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        12345, 999, expect.stringContaining("Waiting"), expect.anything(),
      );
    });
  });

  describe("operator response — governor_changed notifications", () => {
    it("delivers governor_changed service message to all non-target sessions on reroute", async () => {
      const gov = makeSession(1, "Primary");
      const worker2 = makeSession(2, "Worker2");
      const worker3 = makeSession(3, "Worker3");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, worker2, worker3]);
      mocks.getSession.mockReturnValue(worker2);
      await _runHealthCheckNow();
      pressButton("hc_reroute_now:2");
      // worker3 (sid 3) should receive governor_changed; worker2 (sid 2) should not
      expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
        3,
        expect.stringContaining("**New governor:**"),
        "governor_changed",
        { new_governor_sid: 2, new_governor_name: "Worker2" },
      );
    });

    it("delivers governor_changed to all sessions including the new governor", async () => {
      const gov = makeSession(1, "Primary");
      const worker2 = makeSession(2, "Worker2");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, worker2]);
      mocks.getSession.mockReturnValue(worker2);
      await _runHealthCheckNow();
      pressButton("hc_reroute_now:2");
      // deliverServiceMessage SHOULD be called with sid 2 (the new governor) — matching /primary behavior
      const calls = mocks.deliverServiceMessage.mock.calls as unknown as [number, ...unknown[]][];
      const calledForTarget = calls.some(([sid]) => sid === 2);
      expect(calledForTarget).toBe(true);
    });

    it("delivers governor_changed on make-primary path too", async () => {
      const gov = makeSession(1, "Primary");
      const worker2 = makeSession(2, "Worker2");
      const worker3 = makeSession(3, "Worker3");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, worker2, worker3]);
      mocks.getSession.mockReturnValue(worker2);
      await _runHealthCheckNow();
      pressButton("hc_make_primary:2");
      expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
        3,
        expect.stringContaining("**New governor:**"),
        "governor_changed",
        { new_governor_sid: 2, new_governor_name: "Worker2" },
      );
    });

    it("does not deliver governor_changed when operator chooses wait", async () => {
      const gov = makeSession(1, "Primary");
      const worker2 = makeSession(2, "Worker2");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, worker2]);
      await _runHealthCheckNow();
      pressButton("hc_wait");
      expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
    });
  });

  describe("recovery detection", () => {
    it("sends a recovery message when a previously flagged session is no longer unhealthy", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      await _runHealthCheckNow(); // tick 1 — flags session

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]); // session recovered
      await _runHealthCheckNow(); // tick 2 — detects recovery
      expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
        expect.stringContaining("back online"),
      );
    });

    it("allows the session to be flagged again after recovery", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);

      // Tick 1: flag
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);

      // Tick 2: recover
      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(2); // recovery msg

      // Tick 3: goes unhealthy again
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(3); // re-flagged
    });
  });

  describe("recovery detection — session closed before recovery", () => {
    it("does not post back-online when a flagged session is closed (getSession returns undefined)", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // unresponsive warning id = 42

      // Tick 1: session goes unhealthy and is flagged
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);

      // Simulate session/close: session is removed from _sessions
      mocks.getSession.mockReturnValue(undefined);

      // Tick 2: session is no longer in unhealthySids (it's gone), but getSession returns undefined
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();

      // Must NOT post a "back online" message
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);
      expect(mocks.sendServiceMessage).not.toHaveBeenCalledWith(
        expect.stringContaining("back online"),
      );
    });

    it("deletes the unresponsive warning and cleans up tracking when a flagged session is closed", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // unresponsive warning id = 42

      // Tick 1: flag
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      // Simulate session/close
      mocks.getSession.mockReturnValue(undefined);

      // Tick 2: closed session detected in recovery loop
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();

      // The unresponsive warning should still be cleaned up
      expect(mocks.deleteMessage).toHaveBeenCalledWith(12345, 42);
      // clearOnceOnSend should be called for the closed session's SID
      expect(mocks.clearOnceOnSend).toHaveBeenCalledWith(2);
    });
  });

  describe("self-cleaning status messages", () => {
    it("deletes the unresponsive warning message on recovery", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // unresponsive msg_id = 42

      // Tick 1: flag, warning posted with id 42
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      // Tick 2: recover
      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(99); // back-online msg_id = 99
      await _runHealthCheckNow();

      // The unresponsive warning (42) should have been deleted
      expect(mocks.deleteMessage).toHaveBeenCalledWith(12345, 42);
    });

    it("posts back-online message after deleting the warning", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // warning

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(99); // back-online
      await _runHealthCheckNow();

      expect(mocks.sendServiceMessage).toHaveBeenLastCalledWith(
        expect.stringContaining("back online"),
      );
    });

    it("registers a one-shot send hook after posting back-online", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // warning

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(99); // back-online
      await _runHealthCheckNow();

      // registerOnceOnSend should be called with the session's SID (2)
      expect(mocks.registerOnceOnSend).toHaveBeenCalledWith(2, expect.any(Function));
    });

    it("the one-shot hook deletes the back-online message when fired", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // warning

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(99); // back-online id = 99
      await _runHealthCheckNow();

      // Fire the registered hook
      const [, hook] = mocks.registerOnceOnSend.mock.calls[0] as [number, () => void];
      hook();

      expect(mocks.deleteMessage).toHaveBeenCalledWith(12345, 99);
    });

    it("does not delete unresponsive message when sendServiceMessage returns no id", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValue(undefined); // no id returned

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();

      // No deletion should happen
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });

    it("does not register one-shot hook when back-online message has no id", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValue(undefined); // all calls return undefined

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();

      expect(mocks.registerOnceOnSend).not.toHaveBeenCalled();
    });

    it("does not propagate unhandled rejection when delete fails on hook fire", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.sendServiceMessage.mockResolvedValueOnce(42); // warning id
      mocks.deleteMessage.mockRejectedValueOnce(new Error("network error"));

      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();

      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(99); // back-online id
      await _runHealthCheckNow();

      const [, hook] = mocks.registerOnceOnSend.mock.calls[0] as [number, () => void];
      // Firing the hook when deleteMessage rejects should not throw or leak a rejection
      await expect(Promise.resolve().then(hook)).resolves.toBeUndefined();
    });

    it("tracks warning message_id for governor-no-other-session case", async () => {
      const gov = makeSession(1, "Primary");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov]); // no other session
      mocks.sendServiceMessage.mockResolvedValueOnce(77); // governor warning id = 77

      mocks.getUnhealthySessions.mockReturnValue([gov]);
      await _runHealthCheckNow();

      // Recovery: should delete 77
      mocks.getSession.mockReturnValue(makeSession(1, "Primary"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(88); // back-online
      await _runHealthCheckNow();

      expect(mocks.deleteMessage).toHaveBeenCalledWith(12345, 77);
    });
  });

  describe("orphaned back-online message eviction on multiple recoveries", () => {
    it("deletes the previous back-online message when a session recovers a second time without sending", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);

      // Tick 1: session goes unhealthy
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValueOnce(10); // unresponsive warning id = 10
      await _runHealthCheckNow();

      // Tick 2: session recovers — back-online message posted with id 20
      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(20); // back-online id = 20
      await _runHealthCheckNow();
      expect(mocks.registerOnceOnSend).toHaveBeenCalledWith(2, expect.any(Function));

      // Session never sends (hook never fires), goes unhealthy again
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValueOnce(30); // second unresponsive warning id = 30
      await _runHealthCheckNow();

      // Tick 4: session recovers a second time
      mocks.getSession.mockReturnValue(makeSession(2, "Worker"));
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(40); // second back-online id = 40
      await _runHealthCheckNow();

      // The orphaned back-online message from the first recovery (id 20) must have been deleted
      expect(mocks.deleteMessage).toHaveBeenCalledWith(12345, 20);
    });

    it("calls clearOnceOnSend(sid) for the previous hook before registering the new one", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);

      // Tick 1: flag
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValueOnce(10);
      await _runHealthCheckNow();

      // Tick 2: recover (first time)
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(20);
      await _runHealthCheckNow();

      // Tick 3: goes unhealthy again (hook never fired)
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValueOnce(30);
      await _runHealthCheckNow();

      // Tick 4: recover (second time) — eviction should call clearOnceOnSend(2) before new registration
      mocks.getUnhealthySessions.mockReturnValue([]);
      mocks.sendServiceMessage.mockResolvedValueOnce(40);
      await _runHealthCheckNow();

      // clearOnceOnSend should have been called with sid=2 during eviction
      expect(mocks.clearOnceOnSend).toHaveBeenCalledWith(2);
    });
  });

  describe("activity-file guard", () => {
    it("skips health-check for a session with an active activity file that exists on disk", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/activity-abc" });
      mocks.existsSync.mockReturnValue(true);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
      expect(mocks.markUnhealthy).not.toHaveBeenCalled();
    });

    it("sends health-check for a session with no activity file registration", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.getActivityFile.mockReturnValue(undefined);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
        expect.stringContaining("Worker"),
      );
    });

    it("sends health-check for a session whose activity file no longer exists on disk", async () => {
      const s = makeSession(2, "Worker");
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/deleted-file" });
      mocks.existsSync.mockReturnValue(false);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
        expect.stringContaining("Worker"),
      );
    });
  });

  describe("overlapping tick guard", () => {
    it("skips a concurrent tick if one is already running", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);

      // Make sendServiceMessage slow so the first tick is still in-flight
      let resolveFirst!: () => void;
      const firstCallPromise = new Promise<number>((resolve) => {
        resolveFirst = () => { resolve(42); };
      });

      mocks.getUnhealthySessions.mockReturnValue([s]);
      // First tick will await this slow sendServiceMessage
      mocks.sendServiceMessage.mockReturnValueOnce(firstCallPromise as Promise<number | undefined>);

      // Start the first tick but do not await it yet
      const firstTick = _runHealthCheckNow();

      // While first tick is awaiting, start a second tick — should be a no-op
      const secondTick = _runHealthCheckNow();
      await secondTick; // second tick should return immediately

      // The second tick should NOT have called sendServiceMessage again
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);

      // Now let the first tick complete
      resolveFirst();
      await firstTick;
    });

    it("allows a new tick once the previous one finishes", async () => {
      const s = makeSession(2, "Worker");
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValue(undefined);

      // First tick completes fully
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(1);

      // Second tick on same unhealthy session is de-duped by _flaggedSids, not the guard;
      // but a fresh stopHealthCheck + re-flag proves the guard resets.
      stopHealthCheck();
      mocks.getUnhealthySessions.mockReturnValue([s]);
      mocks.sendServiceMessage.mockResolvedValue(undefined);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(2);
    });
  });
});
