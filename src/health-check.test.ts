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
  sendServiceMessage: vi.fn().mockResolvedValue(undefined),
  resolveChat: vi.fn(() => 12345 as number | { code: string; message: string }),
  getApi: vi.fn(),
  listSessions: vi.fn(() => [] as { sid: number; name: string; createdAt: string }[]),
  registerCallbackHook: vi.fn(),
  clearCallbackHook: vi.fn(),
  dlog: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
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
  };
});

vi.mock("./message-store.js", () => ({
  registerCallbackHook: mocks.registerCallbackHook,
  clearCallbackHook: mocks.clearCallbackHook,
}));

vi.mock("./debug-log.js", () => ({
  dlog: mocks.dlog,
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
    stopHealthCheck(); // clears _flaggedSids between tests
    mocks.resolveChat.mockReturnValue(12345);
    mocks.sendMessage.mockResolvedValue({ message_id: 999 });
    mocks.editMessageText.mockResolvedValue(undefined);
    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.sendServiceMessage.mockResolvedValue(undefined);
    mocks.deliverDirectMessage.mockReturnValue(true);
    mocks.deliverServiceMessage.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.getUnhealthySessions.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([]);
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
      expect(mocks.registerCallbackHook).toHaveBeenCalledWith(999, expect.any(Function));
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
        expect.stringContaining("Governor switched"),
        "governor_changed",
        { new_governor_sid: 2, new_governor_name: "Worker2" },
      );
    });

    it("does not deliver governor_changed to the new governor itself", async () => {
      const gov = makeSession(1, "Primary");
      const worker2 = makeSession(2, "Worker2");
      mocks.getUnhealthySessions.mockReturnValue([gov]);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listSessions.mockReturnValue([gov, worker2]);
      mocks.getSession.mockReturnValue(worker2);
      await _runHealthCheckNow();
      pressButton("hc_reroute_now:2");
      // deliverServiceMessage should NOT have been called with sid 2 (the new governor)
      const calls = mocks.deliverServiceMessage.mock.calls as unknown as [number, ...unknown[]][];
      const calledForTarget = calls.some(([sid]) => sid === 2);
      expect(calledForTarget).toBe(false);
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
        expect.stringContaining("Governor switched"),
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
      mocks.getUnhealthySessions.mockReturnValue([]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(2); // recovery msg

      // Tick 3: goes unhealthy again
      mocks.getUnhealthySessions.mockReturnValue([s]);
      await _runHealthCheckNow();
      expect(mocks.sendServiceMessage).toHaveBeenCalledTimes(3); // re-flagged
    });
  });
});
