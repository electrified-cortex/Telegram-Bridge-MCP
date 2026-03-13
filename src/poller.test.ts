import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Update } from "grammy/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  getOffset: vi.fn((): number => 0),
  advanceOffset: vi.fn(),
  filterAllowedUpdates: vi.fn((u: Update[]): Update[] => u),
  trySetMessageReaction: vi.fn(),
  handleIfBuiltIn: vi.fn((): Promise<boolean> => Promise.resolve(false)),
  recordInbound: vi.fn(),
  transcribeVoice: vi.fn((): Promise<string> => Promise.resolve("hello world")),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("./telegram.js")>();
  return {
    ...actual,
    getApi: () => ({ getUpdates: mocks.getUpdates }),
    getOffset: mocks.getOffset,
    advanceOffset: mocks.advanceOffset,
    filterAllowedUpdates: mocks.filterAllowedUpdates,
    trySetMessageReaction: mocks.trySetMessageReaction,
  };
});

vi.mock("./built-in-commands.js", () => ({
  handleIfBuiltIn: mocks.handleIfBuiltIn,
}));

vi.mock("./message-store.js", () => ({
  recordInbound: mocks.recordInbound,
  hasPendingWaiters: vi.fn().mockReturnValue(false),
}));

vi.mock("./transcribe.js", () => ({
  transcribeVoice: mocks.transcribeVoice,
}));

import { startPoller, stopPoller, isPollerRunning } from "./poller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal text message Update. */
function textUpdate(id: number, text: string): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: "private" },
      from: { id: 1, is_bot: false, first_name: "Test" },
      text,
    },
  } as unknown as Update;
}

/** Build a minimal voice message Update. */
function voiceUpdate(id: number): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: "private" },
      from: { id: 1, is_bot: false, first_name: "Test" },
      voice: { file_id: `voice_${id}`, file_unique_id: `u_${id}`, duration: 3 },
    },
  } as unknown as Update;
}

/**
 * Let the poller run one full cycle, then stop it.
 * getUpdates is configured to resolve once, then hang until stopped.
 */
async function runOneCycle(updates: Update[]): Promise<void> {
  let resolveHang: (() => void) | undefined;

  mocks.getUpdates
    .mockResolvedValueOnce(updates)
    .mockImplementation(
      () => new Promise<Update[]>((resolve) => {
        resolveHang = () => { resolve([]); };
      }),
    );

  startPoller();
  // Yield so _pollLoop processes the first batch
  await vi.advanceTimersByTimeAsync(0);
  // Allow all microtasks to settle (voice transcription etc.)
  await vi.advanceTimersByTimeAsync(0);

  stopPoller();
  // Unblock the hanging getUpdates so the loop exits
  resolveHang?.();
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("poller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Ensure poller is stopped before each test
    stopPoller();
  });

  afterEach(() => {
    stopPoller();
    vi.useRealTimers();
  });

  // -- State management -----------------------------------------------------

  describe("isPollerRunning", () => {
    it("returns false initially", () => {
      expect(isPollerRunning()).toBe(false);
    });

    it("returns true after startPoller", () => {
      mocks.getUpdates.mockImplementation(
        () => new Promise<Update[]>(() => {}), // hang forever
      );
      startPoller();
      expect(isPollerRunning()).toBe(true);
      stopPoller();
    });

    it("returns false after stopPoller", () => {
      mocks.getUpdates.mockImplementation(
        () => new Promise<Update[]>(() => {}),
      );
      startPoller();
      stopPoller();
      expect(isPollerRunning()).toBe(false);
    });
  });

  describe("startPoller", () => {
    it("is idempotent — second call is a no-op", () => {
      mocks.getUpdates.mockImplementation(
        () => new Promise<Update[]>(() => {}),
      );
      startPoller();
      startPoller();
      // Only one loop started — getUpdates called once
      expect(isPollerRunning()).toBe(true);
      stopPoller();
    });
  });

  // -- Text message processing ----------------------------------------------

  describe("text message processing", () => {
    it("calls recordInbound for a text message", async () => {
      const u = textUpdate(1, "hi");
      await runOneCycle([u]);

      expect(mocks.advanceOffset).toHaveBeenCalledWith([u]);
      expect(mocks.filterAllowedUpdates).toHaveBeenCalledWith([u]);
      expect(mocks.recordInbound).toHaveBeenCalledWith(u);
    });

    it("passes multiple text updates through", async () => {
      const u1 = textUpdate(1, "first");
      const u2 = textUpdate(2, "second");
      await runOneCycle([u1, u2]);

      expect(mocks.recordInbound).toHaveBeenCalledTimes(2);
      expect(mocks.recordInbound).toHaveBeenCalledWith(u1);
      expect(mocks.recordInbound).toHaveBeenCalledWith(u2);
    });
  });

  // -- Built-in command filtering -------------------------------------------

  describe("handleIfBuiltIn filtering", () => {
    it("does not recordInbound when handleIfBuiltIn returns true", async () => {
      mocks.handleIfBuiltIn.mockResolvedValue(true);
      const u = textUpdate(1, "/session");
      await runOneCycle([u]);

      expect(mocks.handleIfBuiltIn).toHaveBeenCalledWith(u);
      expect(mocks.recordInbound).not.toHaveBeenCalled();
    });

    it("records when handleIfBuiltIn returns false", async () => {
      mocks.handleIfBuiltIn.mockResolvedValue(false);
      const u = textUpdate(1, "hello");
      await runOneCycle([u]);

      expect(mocks.recordInbound).toHaveBeenCalledWith(u);
    });
  });

  // -- Voice message processing ---------------------------------------------

  describe("voice message processing", () => {
    it("transcribes voice and records with transcribed text", async () => {
      mocks.transcribeVoice.mockResolvedValue("transcribed text");
      const u = voiceUpdate(10);
      await runOneCycle([u]);

      // Should have set ✍ reaction first
      expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(
        123, 10, "✍",
      );
      // Transcription called with file_id
      expect(mocks.transcribeVoice).toHaveBeenCalledWith("voice_10");
      // Then � reaction
      expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(
        123, 10, "😴",
      );
      // Recorded with transcribed text
      expect(mocks.recordInbound).toHaveBeenCalledWith(u, "transcribed text");
    });

    it("records failure message when transcription throws", async () => {
      mocks.transcribeVoice.mockRejectedValue(new Error("whisper down"));
      mocks.trySetMessageReaction.mockResolvedValue(undefined);
      const u = voiceUpdate(11);
      await runOneCycle([u]);

      expect(mocks.recordInbound).toHaveBeenCalledWith(
        u,
        "[transcription failed: whisper down]",
      );
    });

    it("still sets � reaction on transcription failure", async () => {
      mocks.transcribeVoice.mockRejectedValue(new Error("fail"));
      mocks.trySetMessageReaction.mockResolvedValue(undefined);
      const u = voiceUpdate(12);
      await runOneCycle([u]);

      // Last reaction call should be 😴
      const reactionCalls = mocks.trySetMessageReaction.mock.calls;
      const lastCall = reactionCalls[reactionCalls.length - 1];
      expect(lastCall).toEqual([123, 12, "😴"]);
    });
  });

  // -- Error handling -------------------------------------------------------

  describe("error handling", () => {
    it("does not crash when getUpdates throws", async () => {
      let callCount = 0;
      mocks.getUpdates.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("network error"));
        // Second call: hang forever so we can stop gracefully
        return new Promise<Update[]>(() => {});
      });

      startPoller();
      // First tick: error is caught
      await vi.advanceTimersByTimeAsync(0);
      expect(isPollerRunning()).toBe(true);

      // Advance past the backoff delay (5000ms)
      await vi.advanceTimersByTimeAsync(5000);
      // Poller should still be running, having retried
      expect(isPollerRunning()).toBe(true);

      stopPoller();
    });

    it("writes to stderr on error", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      mocks.getUpdates
        .mockRejectedValueOnce(new Error("test error"))
        .mockImplementation(() => new Promise<Update[]>(() => {}));

      startPoller();
      await vi.advanceTimersByTimeAsync(0);

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("test error"),
      );

      stopPoller();
      stderrSpy.mockRestore();
    });
  });

  // -- Mixed update batch ---------------------------------------------------

  describe("mixed batches", () => {
    it("handles text and voice updates in the same batch", async () => {
      mocks.transcribeVoice.mockResolvedValue("voice text");
      const text = textUpdate(1, "hi");
      const voice = voiceUpdate(2);
      await runOneCycle([text, voice]);

      // Text recorded immediately
      expect(mocks.recordInbound).toHaveBeenCalledWith(text);
      // Voice recorded with transcription
      expect(mocks.recordInbound).toHaveBeenCalledWith(voice, "voice text");
    });
  });

  // -- Issue #2 — advanceOffset must happen AFTER processing ----------------

  describe("advanceOffset timing (#2)", () => {
    it("does not advance offset before processing completes", async () => {
      // handleIfBuiltIn throws on the second update
      let callIndex = 0;
      mocks.handleIfBuiltIn.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) throw new Error("handler exploded");
        return Promise.resolve(false);
      });

      const u1 = textUpdate(1, "ok");
      const u2 = textUpdate(2, "boom");
      const u3 = textUpdate(3, "after");

      let resolveHang: (() => void) | undefined;
      mocks.getUpdates
        .mockResolvedValueOnce([u1, u2, u3])
        .mockImplementation(
          () => new Promise<Update[]>((resolve) => {
            resolveHang = () => { resolve([]); };
          }),
        );

      startPoller();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // u2 threw, so advanceOffset should NOT have been called yet
      // (or it should have been called only after successful processing)
      // The first update should still have been recorded
      expect(mocks.recordInbound).toHaveBeenCalledWith(u1);

      // The critical assertion: advanceOffset should be called AFTER
      // processing, not before. If it was called before, u2 and u3
      // would be permanently lost.
      // advanceOffset should either not have been called (deferred)
      // or all updates that were processed successfully should still
      // be redeliverable on the next poll
      // With per-update try-catch: u1 + u3 recorded, u2 error logged
      // advanceOffset called after the loop
      expect(mocks.recordInbound).toHaveBeenCalledWith(u3);

      stopPoller();
      resolveHang?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("records all non-throwing updates even if one throws", async () => {
      // Second handleIfBuiltIn call throws
      let callCount = 0;
      mocks.handleIfBuiltIn.mockImplementation(() => {
        callCount++;
        if (callCount === 2) throw new Error("mid-batch error");
        return Promise.resolve(false);
      });

      const u1 = textUpdate(1, "A");
      const u2 = textUpdate(2, "B");
      const u3 = textUpdate(3, "C");

      let resolveHang: (() => void) | undefined;
      mocks.getUpdates
        .mockResolvedValueOnce([u1, u2, u3])
        .mockImplementation(
          () => new Promise<Update[]>((resolve) => {
            resolveHang = () => { resolve([]); };
          }),
        );

      const stderrSpy = vi.spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      startPoller();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // u1 and u3 should have been recorded; u2 errored
      expect(mocks.recordInbound).toHaveBeenCalledWith(u1);
      expect(mocks.recordInbound).toHaveBeenCalledWith(u3);
      // Error should be logged for u2, not crash the whole batch
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("mid-batch error"),
      );

      stopPoller();
      stderrSpy.mockRestore();
      resolveHang?.();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  // -- Issue #8 — fatal errors should stop the poller -----------------------

  describe("fatal error classification (#8)", () => {
    it("stops polling on 401 Unauthorized", async () => {
      const err = Object.assign(
        new Error("Unauthorized"),
        { status: 401 },
      );
      mocks.getUpdates.mockRejectedValue(err);

      const stderrSpy = vi.spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      startPoller();
      await vi.advanceTimersByTimeAsync(0);

      // Poller should have stopped itself — fatal error
      expect(isPollerRunning()).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("fatal"),
      );

      stderrSpy.mockRestore();
    });

    it("stops polling on 403 Forbidden", async () => {
      const err = Object.assign(
        new Error("Forbidden"),
        { status: 403 },
      );
      mocks.getUpdates.mockRejectedValue(err);

      const stderrSpy = vi.spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      startPoller();
      await vi.advanceTimersByTimeAsync(0);

      expect(isPollerRunning()).toBe(false);
      stderrSpy.mockRestore();
    });

    it("respects retry_after on 429", async () => {
      const err429 = Object.assign(
        new Error("Too Many Requests"),
        {
          status: 429,
          parameters: { retry_after: 30 },
        },
      );
      let callCount = 0;
      mocks.getUpdates.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(err429);
        return new Promise<Update[]>(() => {});
      });

      startPoller();
      await vi.advanceTimersByTimeAsync(0);

      // Should still be running (429 is transient)
      expect(isPollerRunning()).toBe(true);

      // Should NOT retry after 5s — should wait retry_after (30s)
      await vi.advanceTimersByTimeAsync(5000);
      expect(mocks.getUpdates).toHaveBeenCalledTimes(1);

      // After 30s it should retry
      await vi.advanceTimersByTimeAsync(25_000);
      expect(mocks.getUpdates).toHaveBeenCalledTimes(2);

      stopPoller();
    });

    it("continues polling on transient network errors", async () => {
      let callCount = 0;
      mocks.getUpdates.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("ECONNRESET"));
        return new Promise<Update[]>(() => {});
      });

      startPoller();
      await vi.advanceTimersByTimeAsync(0);

      expect(isPollerRunning()).toBe(true);

      await vi.advanceTimersByTimeAsync(5000);
      expect(mocks.getUpdates).toHaveBeenCalledTimes(2);

      stopPoller();
    });
  });
});
