import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enqueueAsyncSend,
  cancelSessionJobs,
  resetAsyncSendQueueForTest,
  recordingIndicatorCountForTest,
  acquireRecordingIndicator,
  releaseRecordingIndicator,
  type AsyncSendJob,
} from "./async-send-queue.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  synthesizeToOgg: vi.fn(),
  sendVoiceDirect: vi.fn(),
  sendMessage: vi.fn(),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  splitMessage: vi.fn((t: string) => [t]),
  deliverAsyncSendCallback: vi.fn(() => true),
  createSessionQueue: vi.fn(),
  removeSessionQueue: vi.fn(),
  pauseTypingEmission: vi.fn(),
  resumeTypingEmission: vi.fn(),
}));

vi.mock("./tts.js", () => ({
  synthesizeToOgg: (...args: unknown[]) => mocks.synthesizeToOgg(...args),
}));

vi.mock("./telegram.js", () => ({
  sendVoiceDirect: (...args: unknown[]) => mocks.sendVoiceDirect(...args),
  splitMessage: (t: string) => mocks.splitMessage(t),
  callApi: (fn: () => unknown) => fn(),
  getApi: () => ({ sendMessage: mocks.sendMessage, sendChatAction: mocks.sendChatAction }),
}));

vi.mock("./session-queue.js", () => ({
  deliverAsyncSendCallback: (...args: unknown[]) => mocks.deliverAsyncSendCallback(...args),
}));

vi.mock("./debug-log.js", () => ({
  dlog: vi.fn(),
}));

vi.mock("./typing-state.js", () => ({
  pauseTypingEmission: (...args: unknown[]) => mocks.pauseTypingEmission(...args),
  resumeTypingEmission: (...args: unknown[]) => mocks.resumeTypingEmission(...args),
}));

// ---------------------------------------------------------------------------
// Shared job params (no pendingId / submittedAt — those are assigned by enqueue)
// ---------------------------------------------------------------------------

type JobInput = Omit<AsyncSendJob, "pendingId" | "submittedAt">;

function makeJobParams(overrides: Partial<JobInput> = {}): JobInput {
  return {
    sid: 1,
    chatId: 100,
    audioText: "hello world",
    captionText: undefined,
    captionOverflow: false,
    resolvedVoice: undefined,
    resolvedSpeed: undefined,
    disableNotification: undefined,
    replyToMessageId: undefined,
    timeoutMs: 30_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the promise chain to drain (all micro/macro tasks). */
async function flushJobs(): Promise<void> {
  // Multiple yields needed: synthesize → sendVoice → callback delivery chain
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("async-send-queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAsyncSendQueueForTest();
    mocks.synthesizeToOgg.mockResolvedValue(Buffer.from("ogg-data"));
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 200 });
    mocks.sendMessage.mockResolvedValue({ message_id: 201 });
    mocks.sendChatAction.mockResolvedValue(undefined);
    mocks.splitMessage.mockImplementation((t: string) => [t]);
    mocks.deliverAsyncSendCallback.mockReturnValue(true);
    mocks.pauseTypingEmission.mockReset();
    mocks.resumeTypingEmission.mockReset();
  });

  afterEach(() => {
    resetAsyncSendQueueForTest();
  });

  // -------------------------------------------------------------------------
  // 1. enqueueAsyncSend returns a negative pendingId
  // -------------------------------------------------------------------------
  describe("enqueueAsyncSend returns a negative pendingId", () => {
    it("returns a negative integer", () => {
      const id = enqueueAsyncSend(1, makeJobParams());
      expect(id).toBeLessThan(0);
    });

    it("first pendingId starts at -1_000_000_001", () => {
      const id = enqueueAsyncSend(1, makeJobParams());
      expect(id).toBe(-1_000_000_001);
    });

    it("each subsequent enqueue decrements the pendingId", () => {
      const id1 = enqueueAsyncSend(1, makeJobParams());
      const id2 = enqueueAsyncSend(1, makeJobParams());
      expect(id2).toBe(id1 - 1);
    });

    it("different sessions have independent counters", () => {
      const id1 = enqueueAsyncSend(1, makeJobParams({ sid: 1 }));
      const id2 = enqueueAsyncSend(2, makeJobParams({ sid: 2 }));
      expect(id1).toBe(-1_000_000_001);
      expect(id2).toBe(-1_000_000_001);
    });
  });

  // -------------------------------------------------------------------------
  // 2. FIFO — two enqueued jobs are serialised (second waits for first)
  // -------------------------------------------------------------------------
  describe("FIFO serialisation", () => {
    it("second job does not start until first job has completed", async () => {
      const callOrder: string[] = [];

      // First job: slow synthesize that records when it starts and finishes
      mocks.synthesizeToOgg
        .mockImplementationOnce(async () => {
          callOrder.push("job1-start");
          await Promise.resolve(); // simulate async work
          callOrder.push("job1-done");
          return Buffer.from("ogg1");
        })
        .mockImplementationOnce(() => {
          callOrder.push("job2-start");
          return Promise.resolve(Buffer.from("ogg2"));
        });

      enqueueAsyncSend(1, makeJobParams({ audioText: "job1" }));
      enqueueAsyncSend(1, makeJobParams({ audioText: "job2" }));

      await flushJobs();

      // job2 must not start before job1 is done
      const j2start = callOrder.indexOf("job2-start");
      const j1done = callOrder.indexOf("job1-done");
      expect(j2start).toBeGreaterThan(j1done);
    });
  });

  // -------------------------------------------------------------------------
  // 3. runJob success path — deliverAsyncSendCallback called with status: "ok"
  // -------------------------------------------------------------------------
  describe("success path", () => {
    it("calls deliverAsyncSendCallback with status ok and real message_id", async () => {
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 555 });

      enqueueAsyncSend(1, makeJobParams({ sid: 1 }));
      await flushJobs();

      expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
      const [calledSid, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, { status: string; messageId: number }];
      expect(calledSid).toBe(1);
      expect(payload.status).toBe("ok");
      expect(payload.messageId).toBe(555);
    });

    it("returns messageIds array when there are multiple voice chunks", async () => {
      mocks.splitMessage.mockReturnValue(["chunk1", "chunk2"]);
      mocks.sendVoiceDirect
        .mockResolvedValueOnce({ message_id: 10 })
        .mockResolvedValueOnce({ message_id: 11 });

      enqueueAsyncSend(1, makeJobParams({ sid: 1, audioText: "long text" }));
      await flushJobs();

      const [, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, { messageIds: number[] }];
      expect(payload.messageIds).toEqual([10, 11]);
    });
  });

  // -------------------------------------------------------------------------
  // 3b. captionOverflow path — caption sent as follow-up text message
  // -------------------------------------------------------------------------
  describe("captionOverflow path", () => {
    it("sends voice without caption and follow-up text message when captionOverflow is true", async () => {
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 300 });
      mocks.sendMessage.mockResolvedValue({ message_id: 301 });

      const pendingId = enqueueAsyncSend(1, makeJobParams({
        sid: 1,
        captionText: "*bold text*",
        captionOverflow: true,
      }));
      await flushJobs();

      // sendVoiceDirect must be called with caption: undefined (overflow — no inline caption)
      expect(mocks.sendVoiceDirect).toHaveBeenCalledOnce();
      const voiceArgs = mocks.sendVoiceDirect.mock.calls[0] as [number, Buffer, Record<string, unknown>];
      expect(voiceArgs[2].caption).toBeUndefined();

      // sendMessage must be called with parse_mode MarkdownV2 and the captionText
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
      const msgArgs = mocks.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(msgArgs[1]).toBe("*bold text*");
      expect(msgArgs[2].parse_mode).toBe("MarkdownV2");

      // Callback payload must include textMessageId from the follow-up sendMessage
      expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
      const [, cbPayload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [
        number,
        { pendingId: number; status: string; messageId: number; textMessageId: number },
      ];
      expect(cbPayload.pendingId).toBe(pendingId);
      expect(cbPayload.status).toBe("ok");
      expect(cbPayload.messageId).toBe(300);
      expect(cbPayload.textMessageId).toBe(301);
    });
  });

  // -------------------------------------------------------------------------
  // 4. runJob failure path — deliverAsyncSendCallback called with status: "failed"
  // -------------------------------------------------------------------------
  describe("failure path", () => {
    it("calls deliverAsyncSendCallback with status failed and error message", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("TTS upstream error"));

      enqueueAsyncSend(1, makeJobParams({ sid: 1 }));
      await flushJobs();

      expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
      const [, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, { status: string; error: string }];
      expect(payload.status).toBe("failed");
      expect(payload.error).toBe("TTS upstream error");
    });

    it("does not call deliverAsyncSendCallback twice on failure (finalised guard)", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("fail"));

      enqueueAsyncSend(1, makeJobParams({ sid: 1 }));
      await flushJobs();

      expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 5. runJob timeout path — deliverAsyncSendCallback called with status: "timeout"
  // -------------------------------------------------------------------------
  describe("timeout path", () => {
    it("fires timeout callback when job exceeds timeoutMs", async () => {
      vi.useFakeTimers();
      try {
        // synthesizeToOgg never resolves (simulates a stalled job)
        mocks.synthesizeToOgg.mockImplementation(() => new Promise(() => {}));

        enqueueAsyncSend(1, makeJobParams({ sid: 1, timeoutMs: 5_000 }));

        // Advance past the timeout. Use runOnlyPendingTimersAsync (not runAllTimersAsync)
        // so the recording-indicator setInterval does not loop infinitely under fake timers.
        await vi.runOnlyPendingTimersAsync();
        await flushJobs();

        expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
        const [, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, { status: string }];
        expect(payload.status).toBe("timeout");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not deliver a second callback when runJob eventually fails after timeout", async () => {
      vi.useFakeTimers();
      try {
        let rejectJob!: (err: Error) => void;
        mocks.synthesizeToOgg.mockImplementation(
          () => new Promise<Buffer>((_, reject) => { rejectJob = reject; }),
        );

        enqueueAsyncSend(1, makeJobParams({ sid: 1, timeoutMs: 5_000 }));

        // Trigger timeout. Use runOnlyPendingTimersAsync (not runAllTimersAsync)
        // so the recording-indicator setInterval does not loop infinitely under fake timers.
        await vi.runOnlyPendingTimersAsync();
        await flushJobs();

        expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();

        // Now the stalled job fails — should be a no-op (already finalised)
        rejectJob(new Error("late error"));
        await flushJobs();

        expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce(); // still only once
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 6. Text fallback — captionText present and job fails
  // -------------------------------------------------------------------------
  describe("text fallback on failure", () => {
    it("sends plain-text fallback message when captionText is present and job fails", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("TTS error"));
      mocks.sendMessage.mockResolvedValue({ message_id: 999 });

      enqueueAsyncSend(1, makeJobParams({
        sid: 1,
        captionText: "caption content",
      }));
      await flushJobs();

      // sendMessage should have been called for the fallback
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
      const sendArgs = mocks.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      // Fallback is plain text — no parse_mode
      expect(sendArgs[1]).toContain("⚠ [async failed]");
      expect(sendArgs[1]).toContain("caption content");
      expect(sendArgs[2].parse_mode).toBeUndefined();
    });

    it("callback has text_fallback: true and textMessageId when fallback send succeeds", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("fail"));
      mocks.sendMessage.mockResolvedValue({ message_id: 888 });

      enqueueAsyncSend(1, makeJobParams({ sid: 1, captionText: "the caption" }));
      await flushJobs();

      const [, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, {
        status: string;
        textFallback?: boolean;
        textMessageId?: number;
      }];
      expect(payload.textFallback).toBe(true);
      expect(payload.textMessageId).toBe(888);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Audio-only failure — no fallback when captionText is undefined
  // -------------------------------------------------------------------------
  describe("audio-only failure (no caption)", () => {
    it("does not send a fallback message when captionText is undefined", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("TTS error"));

      enqueueAsyncSend(1, makeJobParams({ sid: 1, captionText: undefined }));
      await flushJobs();

      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it("callback has no text_fallback field when captionText is absent", async () => {
      mocks.synthesizeToOgg.mockRejectedValue(new Error("fail"));

      enqueueAsyncSend(1, makeJobParams({ sid: 1, captionText: undefined }));
      await flushJobs();

      const [, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [number, {
        textFallback?: boolean;
      }];
      expect(payload.textFallback).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. cancelSessionJobs
  // -------------------------------------------------------------------------
  describe("cancelSessionJobs", () => {
    it("pending jobs that have not started are never executed after cancel", async () => {
      // Block the first job indefinitely so the second stays pending
      mocks.synthesizeToOgg.mockImplementation(() => new Promise(() => {}));

      enqueueAsyncSend(1, makeJobParams({ sid: 1, audioText: "job1" }));
      enqueueAsyncSend(1, makeJobParams({ sid: 1, audioText: "job2" }));

      // Cancel the session — removes the session state
      cancelSessionJobs(1);

      // Let things settle
      await flushJobs();

      // No callback should have been delivered (session gone, queue gone)
      // The in-flight job1 is stalled; job2 is queued but session is deleted.
      // deliverAsyncSendCallback returns false when queue is gone.
      expect(mocks.deliverAsyncSendCallback).not.toHaveBeenCalled();
    });

    it("in-flight job delivers callback with queue gone (deliverAsyncSendCallback returns false)", async () => {
      // Job completes normally but session is cancelled before callback delivery.
      // We need the job to start executing before we cancel, so we flush first to
      // let synthesizeToOgg get invoked and capture the resolve callback.
      let resolveJob: ((buf: Buffer) => void) | undefined;
      mocks.synthesizeToOgg.mockImplementation(
        () => new Promise<Buffer>((resolve) => { resolveJob = resolve; }),
      );
      // deliverAsyncSendCallback returns false (queue gone)
      mocks.deliverAsyncSendCallback.mockReturnValue(false);
      // sendVoiceDirect is set up now so it's ready when the job continues
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 77 });

      const pendingId = enqueueAsyncSend(1, makeJobParams({ sid: 1 }));

      // Flush until synthesizeToOgg is called (job started, resolveJob is set)
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        if (resolveJob !== undefined) break;
      }
      expect(resolveJob).toBeDefined();

      // Cancel session while job is still in-flight.
      // cancelSessionJobs removes the pendingId from _finalisedJobs accounting
      // but does NOT mark the job as finalised — the in-flight job is still free
      // to complete and deliver its callback.
      cancelSessionJobs(1);

      // Now resolve the stalled job — it should complete normally
      resolveJob!(Buffer.from("ogg"));
      await flushJobs();

      // The in-flight job was not cancelled (only removed from future accounting),
      // so deliverAsyncSendCallback must have been called exactly once with status ok.
      expect(mocks.deliverAsyncSendCallback).toHaveBeenCalledOnce();
      const [calledSid, payload] = mocks.deliverAsyncSendCallback.mock.calls[0] as [
        number,
        { pendingId: number; status: string; messageId: number },
      ];
      expect(calledSid).toBe(1);
      expect(payload.pendingId).toBe(pendingId);
      expect(payload.status).toBe("ok");
      expect(payload.messageId).toBe(77);
    });

    it("is a no-op for an unknown session", () => {
      expect(() => { cancelSessionJobs(999); }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Recording indicator — sendChatAction called with "record_voice"
  // -------------------------------------------------------------------------
  describe("recording indicator", () => {
    it("calls sendChatAction with record_voice for each audio send", async () => {
      enqueueAsyncSend(1, makeJobParams({ sid: 1 }));
      await flushJobs();

      expect(mocks.sendChatAction).toHaveBeenCalledWith(100, "record_voice");
    });

    it("two concurrent jobs to the same chat share one interval (no stop between them)", async () => {
      vi.useFakeTimers();
      try {
        // First job: controlled — resolves after we advance timers.
        let resolveJob1!: (buf: Buffer) => void;
        let resolveJob2!: (buf: Buffer) => void;
        mocks.synthesizeToOgg
          .mockImplementationOnce(
            () => new Promise<Buffer>((resolve) => { resolveJob1 = resolve; }),
          )
          .mockImplementationOnce(
            () => new Promise<Buffer>((resolve) => { resolveJob2 = resolve; }),
          );
        mocks.sendVoiceDirect.mockResolvedValue({ message_id: 1 });

        // Enqueue two jobs to the same chat from DIFFERENT sessions so they
        // run concurrently (per-session chains are independent). Same sid
        // would serialize them and each would 0→1 the chat refcount in turn,
        // producing two initial record_voice fires instead of one.
        enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100 }));
        enqueueAsyncSend(2, makeJobParams({ sid: 2, chatId: 100 }));

        // Yield enough times for both jobs to start and acquire the indicator.
        await flushJobs();

        // Refcount is 2 (one shared interval), only one record_voice fired.
        expect(recordingIndicatorCountForTest()).toBe(1);

        // Complete job1 — refcount drops 2 → 1, interval stays active.
        resolveJob1(Buffer.from("ogg1"));
        await flushJobs();
        expect(recordingIndicatorCountForTest()).toBe(1);

        // Complete job2 — refcount drops 1 → 0, interval cleared.
        resolveJob2(Buffer.from("ogg2"));
        await flushJobs();
        expect(recordingIndicatorCountForTest()).toBe(0);

        // sendChatAction should have been called exactly once initially
        // (both jobs share the indicator — no extra immediate call for job2).
        const recordVoiceCalls = mocks.sendChatAction.mock.calls.filter(
          (c) => c[1] === "record_voice",
        );
        expect(recordVoiceCalls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("interval fires again at 4 s intervals while jobs are in flight", async () => {
      vi.useFakeTimers();
      try {
        let resolveJob!: (buf: Buffer) => void;
        mocks.synthesizeToOgg.mockImplementationOnce(
          () => new Promise<Buffer>((resolve) => { resolveJob = resolve; }),
        );
        mocks.sendVoiceDirect.mockResolvedValue({ message_id: 1 });

        enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100 }));
        await Promise.resolve();
        await Promise.resolve();

        // Advance 4 s — interval should fire once more.
        await vi.advanceTimersByTimeAsync(4_000);
        const callsAfterInterval = mocks.sendChatAction.mock.calls.filter(
          (c) => c[1] === "record_voice",
        );
        // At minimum: initial call + 1 interval tick
        expect(callsAfterInterval.length).toBeGreaterThanOrEqual(2);

        // Finish the job so the interval is cleared and fake-timers can be restored cleanly.
        resolveJob(Buffer.from("ogg"));
        await flushJobs();
        expect(recordingIndicatorCountForTest()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 10. Typing suppression — recording supersedes typing
  // -------------------------------------------------------------------------
  describe("typing suppression", () => {
    it("pauseTypingEmission is called when the first async job starts for a chat", async () => {
      vi.useFakeTimers();
      try {
        let resolveJob!: (buf: Buffer) => void;
        mocks.synthesizeToOgg.mockImplementationOnce(
          () => new Promise<Buffer>((resolve) => { resolveJob = resolve; }),
        );
        mocks.sendVoiceDirect.mockResolvedValue({ message_id: 1 });

        enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100 }));
        // Yield until the job actually starts and acquires the indicator.
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.pauseTypingEmission).toHaveBeenCalledWith(100);

        resolveJob(Buffer.from("ogg"));
        await flushJobs();
      } finally {
        vi.useRealTimers();
      }
    });

    it("resumeTypingEmission is called when the last job for a chat finishes", async () => {
      enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100 }));
      await flushJobs();

      expect(mocks.resumeTypingEmission).toHaveBeenCalledWith(100);
    });

    it("pauseTypingEmission called once for two concurrent jobs (different sessions, same chat)", async () => {
      vi.useFakeTimers();
      try {
        // Two sessions both targeting chatId 100 run concurrently because each
        // session has its own independent promise chain.
        let resolveJob1!: (buf: Buffer) => void;
        let resolveJob2!: (buf: Buffer) => void;
        mocks.synthesizeToOgg
          .mockImplementationOnce(
            () => new Promise<Buffer>((resolve) => { resolveJob1 = resolve; }),
          )
          .mockImplementationOnce(
            () => new Promise<Buffer>((resolve) => { resolveJob2 = resolve; }),
          );
        mocks.sendVoiceDirect.mockResolvedValue({ message_id: 1 });

        // sid 1 and sid 2 — independent chains, both targeting chatId 100.
        enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100 }));
        enqueueAsyncSend(2, makeJobParams({ sid: 2, chatId: 100 }));
        // Yield enough for both independent session chains to start.
        for (let i = 0; i < 6; i++) await Promise.resolve();

        // pauseTypingEmission fires only once (0 → 1 transition on the shared chatId indicator).
        expect(mocks.pauseTypingEmission).toHaveBeenCalledTimes(1);
        expect(mocks.resumeTypingEmission).not.toHaveBeenCalled();

        // Complete job1 (from sid 1) — refcount 2 → 1; resume not yet called.
        resolveJob1(Buffer.from("ogg1"));
        await flushJobs();
        expect(mocks.resumeTypingEmission).not.toHaveBeenCalled();

        // Complete job2 (from sid 2) — refcount 1 → 0; resume now called.
        resolveJob2(Buffer.from("ogg2"));
        await flushJobs();
        expect(mocks.resumeTypingEmission).toHaveBeenCalledTimes(1);
        expect(mocks.resumeTypingEmission).toHaveBeenCalledWith(100);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 11. Safety bound — force-clears recording indicator after 120 s
  // -------------------------------------------------------------------------
  describe("recording indicator safety bound", () => {
    it("force-clears the interval after 120 s when a job never releases", async () => {
      vi.useFakeTimers();
      try {
        // Job that never resolves — simulates a completely hung synthesizer.
        mocks.synthesizeToOgg.mockImplementation(() => new Promise(() => {}));

        enqueueAsyncSend(1, makeJobParams({ sid: 1, chatId: 100, timeoutMs: 300_000 }));
        // Yield so the job starts and acquires the indicator.
        await Promise.resolve();
        await Promise.resolve();

        expect(recordingIndicatorCountForTest()).toBe(1);

        // Advance to just before the safety bound — indicator must still be active.
        await vi.advanceTimersByTimeAsync(119_999);
        expect(recordingIndicatorCountForTest()).toBe(1);

        // Advance past the safety bound.
        await vi.advanceTimersByTimeAsync(2);
        expect(recordingIndicatorCountForTest()).toBe(0);

        // resumeTypingEmission must be called by the safety handler.
        expect(mocks.resumeTypingEmission).toHaveBeenCalledWith(100);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 12. Sync voice path — acquireRecordingIndicator / releaseRecordingIndicator
  // -------------------------------------------------------------------------
  describe("acquireRecordingIndicator / releaseRecordingIndicator (public API)", () => {
    it("acquire starts the recording indicator and suppresses typing", () => {
      acquireRecordingIndicator(200);
      expect(recordingIndicatorCountForTest()).toBe(1);
      expect(mocks.pauseTypingEmission).toHaveBeenCalledWith(200);
      // Cleanup
      releaseRecordingIndicator(200);
    });

    it("release clears the indicator and resumes typing", () => {
      acquireRecordingIndicator(200);
      releaseRecordingIndicator(200);
      expect(recordingIndicatorCountForTest()).toBe(0);
      expect(mocks.resumeTypingEmission).toHaveBeenCalledWith(200);
    });

    it("acquire/release is balanced across multiple calls", () => {
      acquireRecordingIndicator(200);
      acquireRecordingIndicator(200);
      expect(recordingIndicatorCountForTest()).toBe(1); // one interval entry, count=2
      releaseRecordingIndicator(200);
      expect(recordingIndicatorCountForTest()).toBe(1); // count=1, still active
      releaseRecordingIndicator(200);
      expect(recordingIndicatorCountForTest()).toBe(0); // released
      expect(mocks.resumeTypingEmission).toHaveBeenCalledTimes(1);
    });
  });
});
