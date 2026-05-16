import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  dequeueMatch: vi.fn(),
  waitForEnqueue: vi.fn(),
  ackVoiceMessage: vi.fn(),
  sessionQueue: {
    dequeueMatch: vi.fn(),
    waitForEnqueue: vi.fn(),
  },
  sessionQueue2: {
    dequeueMatch: vi.fn(),
    waitForEnqueue: vi.fn(),
  },
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: () => 42,
    ackVoiceMessage: mocks.ackVoiceMessage,
  };
});

vi.mock("../message-store.js", () => ({
  dequeueMatch: mocks.dequeueMatch,
  waitForEnqueue: mocks.waitForEnqueue,
}));

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => {
    if (sid === 1) return mocks.sessionQueue;
    if (sid === 2) return mocks.sessionQueue2;
    return undefined;
  },
}));

import {
  ackAndEditSelection,
  editWithTimedOut,
  editWithSkipped,
  highlightThenCollapse,
  pollButtonPress,
  pollButtonOrTextOrVoice,
  buildHighlightedRows,
} from "./button-helpers.js";

describe("button-helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ackAndEditSelection", () => {
    it("edits message with chosen label and removes buttons", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockResolvedValue(true);
      await ackAndEditSelection(42, 1, "Question?", "Yes", "cq1");
      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1, expect.stringContaining("Yes"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("skips answerCallbackQuery when callbackQueryId is undefined", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await ackAndEditSelection(42, 1, "Question?", "Yes", undefined);
      expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it("swallows answerCallbackQuery errors (already answered, etc.)", async () => {
      mocks.answerCallbackQuery.mockRejectedValue(new Error("Already answered"));
      mocks.editMessageText.mockResolvedValue(true);
      await expect(ackAndEditSelection(42, 1, "Question?", "Yes", "cq1")).resolves.toBeUndefined();
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(ackAndEditSelection(42, 1, "Question?", "Yes", "cq1")).resolves.toBeUndefined();
    });

    it("passes highlighted keyboard when highlightedRows is provided", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockResolvedValue(true);
      const rows = [[
        { text: "Yes", callback_data: "yes", style: "primary" as const },
        { text: "No", callback_data: "no" },
      ]];
      await ackAndEditSelection(42, 1, "Question?", "Yes", "cq1", false, rows);
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1, expect.any(String),
        expect.objectContaining({ reply_markup: { inline_keyboard: rows } }),
      );
    });

    it("removes buttons when highlightedRows is omitted", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockResolvedValue(true);
      await ackAndEditSelection(42, 1, "Question?", "Yes", "cq1");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1, expect.any(String),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });
  });

  describe("buildHighlightedRows", () => {
    it("sets unstyled clicked button to primary style", () => {
      const opts = [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ];
      const rows = buildHighlightedRows(opts, 2, "a");
      expect(rows).toEqual([[
        { text: "A", callback_data: "a", style: "primary" },
        { text: "B", callback_data: "b" },
      ]]);
    });

    it("leaves non-clicked buttons without style (stripped plain)", () => {
      const opts = [
        { label: "X", value: "x" },
        { label: "Y", value: "y" },
        { label: "Z", value: "z" },
      ];
      const rows = buildHighlightedRows(opts, 3, "z");
      expect(rows[0][0]).not.toHaveProperty("style");
      expect(rows[0][1]).not.toHaveProperty("style");
      expect(rows[0][2]).toMatchObject({ style: "primary" });
    });

    it("preserves original style on clicked button; strips style from non-clicked", () => {
      const opts = [
        { label: "Good", value: "good", style: "success" as const },
        { label: "Bad", value: "bad", style: "danger" as const },
      ];
      const rows = buildHighlightedRows(opts, 2, "bad");
      // Non-clicked button has its style stripped (plain)
      expect(rows[0][0]).not.toHaveProperty("style");
      // Clicked button keeps its original style (danger, not overridden to primary)
      expect(rows[0][1]).toMatchObject({ style: "danger" });
    });

    it("clicked button with no style falls back to primary", () => {
      const opts = [
        { label: "Good", value: "good", style: "success" as const },
        { label: "Plain", value: "plain" },
      ];
      const rows = buildHighlightedRows(opts, 2, "plain");
      // Clicked button (no original style) gets primary as fallback
      expect(rows[0][1]).toMatchObject({ style: "primary" });
      // Non-clicked button has its style stripped
      expect(rows[0][0]).not.toHaveProperty("style");
    });

    it("respects column layout", () => {
      const opts = [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
        { label: "C", value: "c" },
      ];
      const rows = buildHighlightedRows(opts, 1, "b");
      expect(rows).toHaveLength(3);
      expect(rows[1][0]).toMatchObject({ style: "primary" });
    });

    it("applies no highlight when clickedValue does not match any option", () => {
      const opts = [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ];
      const rows = buildHighlightedRows(opts, 2, "ghost");
      expect(rows[0][0]).not.toHaveProperty("style");
      expect(rows[0][1]).not.toHaveProperty("style");
    });
  });

  describe("highlightThenCollapse", () => {
    const HIGHLIGHTED_ROWS = [[
      { text: "Like it", callback_data: "like", style: "primary" as const },
      { text: "Dislike it", callback_data: "dislike" },
    ]];

    beforeEach(() => {
      mocks.answerCallbackQuery.mockResolvedValue(undefined);
      mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
      mocks.editMessageText.mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stage 1: answers callback query and calls editMessageReplyMarkup with highlighted keyboard", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS);
      // Flush microtasks for stage 1
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1");
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
        42, 1,
        expect.objectContaining({ reply_markup: { inline_keyboard: HIGHLIGHTED_ROWS } }),
      );
      // Stage 2 not yet fired — timer hasn't advanced
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();
      await p;
    });

    it("stage 2: after delay calls editMessageText with empty keyboard and selection suffix", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS);
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(300);
      await p;

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1,
        expect.stringContaining("Like it"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("stage 1 error: editMessageReplyMarkup throws — error swallowed, stage 2 still runs", async () => {
      vi.useFakeTimers();
      mocks.editMessageReplyMarkup.mockRejectedValue(new Error("network error"));
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS);
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(300);
      // Should not throw even though stage 1 failed
      await expect(p).resolves.toBeUndefined();
      // Stage 2 still ran
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("callbackQueryId undefined: answerCallbackQuery not called, stage 1 and 2 still run", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", undefined, HIGHLIGHTED_ROWS);
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      await p;
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("stage 2 does not fire before the delay elapses (default 250 ms)", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS);
      await Promise.resolve();
      await Promise.resolve();

      // Advance to just under the default 250 ms delay — stage 2 must not have fired
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      // Advance past the threshold — stage 2 fires
      await vi.advanceTimersByTimeAsync(300);
      await p;
      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("custom delayMs overrides the default 250 ms", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS, 50);
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(60);
      await p;
      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("stage 2 reply_markup has empty inline_keyboard (not omitted)", async () => {
      vi.useFakeTimers();
      const p = highlightThenCollapse(42, 1, "Pick one", "Like it", "cq1", HIGHLIGHTED_ROWS);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await p;

      const callArgs = mocks.editMessageText.mock.calls[0] as [number, number, string, Record<string, unknown>];
      const markup = callArgs[3].reply_markup as { inline_keyboard: unknown[][] };
      expect(markup).toBeDefined();
      expect(markup.inline_keyboard).toEqual([]);
    });
  });

  describe("editWithTimedOut", () => {
    it("edits message to show timed-out indicator and removes buttons", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await editWithTimedOut(42, 1, "Question?");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1, expect.stringContaining("Timed out"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(editWithTimedOut(42, 1, "Question?")).resolves.toBeUndefined();
    });
  });

  describe("editWithSkipped", () => {
    it("edits message to show skipped indicator and removes buttons", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await editWithSkipped(42, 1, "Question?");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 1, expect.stringContaining("Skipped"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(editWithSkipped(42, 1, "Question?")).resolves.toBeUndefined();
    });
  });

  // -- pollButtonPress -----------------------------------------------------

  describe("pollButtonPress", () => {
    it("returns button result when callback matches", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "callback",
          content: { target: 10, qid: "q1", data: "yes" },
        });
      });
      const result = await pollButtonPress(123, 10, 1);
      expect(result).toEqual({
        kind: "button",
        callback_query_id: "q1",
        data: "yes",
        message_id: 10,
      });
    });

    it("returns null on timeout with no match", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonPress(123, 10, 0.01);
      expect(result).toBeNull();
    });

    it("ignores callbacks for different message_id", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "callback",
          content: { target: 999, qid: "q1", data: "no" },
        });
      });
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonPress(123, 10, 0.01);
      expect(result).toBeNull();
    });
    it("returns null when signal is pre-aborted", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      mocks.waitForEnqueue.mockImplementation(() => new Promise(() => {})); // never resolves
      const controller = new AbortController();
      controller.abort();
      const result = await pollButtonPress(123, 10, 10, controller.signal);
      expect(result).toBeNull();
    });

    it("returns null when signal is aborted during wait", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      let resolveEnqueue!: () => void;
      mocks.waitForEnqueue.mockImplementation(() => new Promise<void>((r) => { resolveEnqueue = r; }));
      const controller = new AbortController();
      const resultPromise = pollButtonPress(123, 10, 10, controller.signal);
      controller.abort();
      resolveEnqueue();
      const result = await resultPromise;
      expect(result).toBeNull();
    });
  });

  // -- pollButtonOrTextOrVoice ---------------------------------------------

  describe("pollButtonOrTextOrVoice", () => {
    it("returns null when signal is pre-aborted", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      mocks.waitForEnqueue.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      controller.abort();
      const result = await pollButtonOrTextOrVoice(123, 10, 10, undefined, controller.signal);
      expect(result).toBeNull();
    });

    it("returns null when signal is aborted during wait", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      let resolveEnqueue!: () => void;
      mocks.waitForEnqueue.mockImplementation(() => new Promise<void>((r) => { resolveEnqueue = r; }));
      const controller = new AbortController();
      const resultPromise = pollButtonOrTextOrVoice(123, 10, 10, undefined, controller.signal);
      controller.abort();
      resolveEnqueue();
      const result = await resultPromise;
      expect(result).toBeNull();
    });

    it("returns button result for matching callback", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "callback",
          content: { target: 10, qid: "q1", data: "a" },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).toEqual({
        kind: "button",
        callback_query_id: "q1",
        data: "a",
        message_id: 10,
      });
    });

    it("returns text result for text message after question", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "text", text: "typed answer" },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).toEqual({
        kind: "text",
        message_id: 11,
        text: "typed answer",
      });
    });

    it("returns voice result for voice message", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "voice", text: "transcribed" },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).toEqual({
        kind: "voice",
        message_id: 11,
        text: "transcribed",
      });
    });

    it("sets 🫡 reaction on voice message dequeue", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "voice", text: "hello" },
        });
      });
      await pollButtonOrTextOrVoice(123, 10, 1);
      expect(mocks.ackVoiceMessage).toHaveBeenCalledWith(11);
    });

    it("ignores messages with id <= question id", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        // Message with same ID as question — should not match
        return fn({
          event: "message",
          id: 10,
          content: { type: "text", text: "stale" },
        });
      });
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonOrTextOrVoice(123, 10, 0.01);
      expect(result).toBeNull();
    });

    it("returns null on timeout", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonOrTextOrVoice(123, 10, 0.01);
      expect(result).toBeNull();
    });

    // Issue #4 — commands during button/text wait
    it("returns command as break signal instead of ignoring (#4)", async () => {
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "command", text: "cancel" },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("command");
    });

    it("fires onVoiceDetected immediately when voice arrives without transcription", async () => {
      // First call: voice with no text (pending transcription)
      // Second call: same voice with text (transcription done)
      let callCount = 0;
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        callCount++;
        if (callCount === 1) {
          fn({ event: "message", id: 11, content: { type: "voice" } }); // no text yet
          return undefined;
        }
        return fn({ event: "message", id: 11, content: { type: "voice", text: "done" } });
      });
      mocks.waitForEnqueue.mockResolvedValue(undefined);

      const onVoiceDetected = vi.fn();
      const result = await pollButtonOrTextOrVoice(123, 10, 1, onVoiceDetected);

      expect(onVoiceDetected).toHaveBeenCalledOnce();
      expect(result).toEqual({ kind: "voice", message_id: 11, text: "done" });
    });

    it("fires onVoiceDetected only once even across multiple loops", async () => {
      let callCount = 0;
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        callCount++;
        if (callCount <= 2) {
          fn({ event: "message", id: 11, content: { type: "voice" } }); // no text
          return undefined;
        }
        return fn({ event: "message", id: 11, content: { type: "voice", text: "ready" } });
      });
      mocks.waitForEnqueue.mockResolvedValue(undefined);

      const onVoiceDetected = vi.fn();
      await pollButtonOrTextOrVoice(123, 10, 1, onVoiceDetected);

      expect(onVoiceDetected).toHaveBeenCalledOnce();
    });

    // reply_to guard — off-target replies must not resolve the active question
    it("does not resolve when incoming message is a reply to a different message (reply_to != questionId)", async () => {
      // The active question is message ID 10. An off-target reply targets message 5.
      // It should NOT be consumed and the poll should time out (return null).
      let matchFnResult: unknown = "unset";
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        matchFnResult = fn({
          event: "message",
          id: 11,
          content: { type: "text", text: "reply to something else", reply_to: 5 },
        });
        return undefined; // guard returned undefined — event not consumed
      });
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonOrTextOrVoice(123, 10, 0.01);
      expect(matchFnResult).toBeUndefined(); // guard must return undefined for off-target reply
      expect(result).toBeNull();
    });

    it("resolves normally when incoming message is a reply targeting the active question (reply_to == questionId)", async () => {
      // reply_to matches the active question ID — should be consumed as a text response.
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "text", text: "direct reply", reply_to: 10 },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).toEqual({ kind: "text", message_id: 11, text: "direct reply", reply_to: 10 });
    });

    it("resolves normally when incoming message has no reply_to (ambiguous — existing behaviour preserved)", async () => {
      // reply_to is absent — treat as a response to the active question (existing behaviour).
      mocks.dequeueMatch.mockImplementation((fn: (e: unknown) => unknown) => {
        return fn({
          event: "message",
          id: 11,
          content: { type: "text", text: "free text" },
        });
      });
      const result = await pollButtonOrTextOrVoice(123, 10, 1);
      expect(result).toEqual({ kind: "text", message_id: 11, text: "free text" });
    });
  });

  // -- session-aware polling -----------------------------------------------

  describe("session-aware polling", () => {
    beforeEach(() => {
      mocks.sessionQueue.dequeueMatch.mockReset();
      mocks.sessionQueue.waitForEnqueue.mockReset();
      mocks.sessionQueue2.dequeueMatch.mockReset();
      mocks.sessionQueue2.waitForEnqueue.mockReset();
    });

    it("pollButtonPress uses session queue when sid is provided", async () => {
      mocks.sessionQueue.dequeueMatch.mockImplementation(
        (fn: (e: unknown) => unknown) =>
          fn({ event: "callback", content: { target: 10, qid: "q1", data: "yes" } }),
      );
      const result = await pollButtonPress(123, 10, 1, undefined, 1);
      expect(result).toEqual({
        kind: "button",
        callback_query_id: "q1",
        data: "yes",
        message_id: 10,
      });
      expect(mocks.sessionQueue.dequeueMatch).toHaveBeenCalled();
      expect(mocks.dequeueMatch).not.toHaveBeenCalled();
    });

    it("pollButtonPress falls back to global when sid is 0", async () => {
      mocks.dequeueMatch.mockImplementation(
        (fn: (e: unknown) => unknown) =>
          fn({ event: "callback", content: { target: 10, qid: "q2", data: "no" } }),
      );
      const result = await pollButtonPress(123, 10, 1, undefined, 0);
      expect(mocks.dequeueMatch).toHaveBeenCalled();
      expect(mocks.sessionQueue.dequeueMatch).not.toHaveBeenCalled();
      expect(result?.data).toBe("no");
    });

    it("pollButtonOrTextOrVoice uses session queue when sid > 0", async () => {
      mocks.sessionQueue.dequeueMatch.mockImplementation(
        (fn: (e: unknown) => unknown) =>
          fn({ event: "message", id: 11, content: { type: "text", text: "hi" } }),
      );
      const result = await pollButtonOrTextOrVoice(
        123, 10, 1, undefined, undefined, 1,
      );
      expect(result).toEqual({ kind: "text", message_id: 11, text: "hi" });
      expect(mocks.sessionQueue.dequeueMatch).toHaveBeenCalled();
      expect(mocks.dequeueMatch).not.toHaveBeenCalled();
    });

    it("pollButtonOrTextOrVoice waits on session queue", async () => {
      mocks.sessionQueue.dequeueMatch.mockReturnValue(undefined);
      mocks.sessionQueue.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      const result = await pollButtonOrTextOrVoice(
        123, 10, 0.01, undefined, undefined, 1,
      );
      expect(result).toBeNull();
      expect(mocks.sessionQueue.waitForEnqueue).toHaveBeenCalled();
      expect(mocks.waitForEnqueue).not.toHaveBeenCalled();
    });

    it("pollButtonPress falls back to global for unknown sid", async () => {
      mocks.dequeueMatch.mockReturnValue(undefined);
      mocks.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );
      // sid=999 has no queue — falls back to global
      const result = await pollButtonPress(123, 10, 0.01, undefined, 999);
      expect(mocks.dequeueMatch).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("session 1's callback is invisible to session 2's poll", async () => {
      // Session 1 has a matching callback event sitting in its queue
      mocks.sessionQueue.dequeueMatch.mockImplementation(
        (fn: (e: unknown) => unknown) =>
          fn({ event: "callback", content: { target: 10, qid: "q-s1", data: "s1-result" } }),
      );
      // Session 2's queue is empty — times out immediately
      mocks.sessionQueue2.dequeueMatch.mockReturnValue(undefined);
      mocks.sessionQueue2.waitForEnqueue.mockImplementation(
        () => new Promise((r) => setTimeout(r, 100)),
      );

      // Session 2 polls — must not consume session 1's event
      const result = await pollButtonOrTextOrVoice(123, 10, 0.01, undefined, undefined, 2);
      expect(result).toBeNull();
      // Session 2's own queue was used
      expect(mocks.sessionQueue2.dequeueMatch).toHaveBeenCalled();
      // Session 1's queue was never touched
      expect(mocks.sessionQueue.dequeueMatch).not.toHaveBeenCalled();
    });
  });
});
