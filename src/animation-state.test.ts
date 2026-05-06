import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  deleteMessage: vi.fn(),
  resolveChat: vi.fn((): number => 123),
  registerSendInterceptor: vi.fn(),
  clearSendInterceptor: vi.fn(),
  getHighestMessageId: vi.fn((): number => 0),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getRawApi: () => ({
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      deleteMessage: mocks.deleteMessage,
    }),
    resolveChat: mocks.resolveChat,
  };
});

vi.mock("./outbound-proxy.js", () => ({
  registerSendInterceptor: mocks.registerSendInterceptor,
  clearSendInterceptor: mocks.clearSendInterceptor,
  bypassProxy: (fn: () => unknown) => fn(),
  fireTempReactionRestore: vi.fn().mockResolvedValue(undefined),
  buildHeader: vi.fn().mockReturnValue({ plain: "", formatted: "" }),
}));

vi.mock("./message-store.js", () => ({
  recordOutgoing: vi.fn(),
  getHighestMessageId: mocks.getHighestMessageId,
  trackMessageId: vi.fn(),
}));

import { GrammyError } from "grammy";
import {
  startAnimation,
  cancelAnimation,
  resetAnimationTimeout,
  getAnimationMessageId,
  isAnimationActive,
  isAnimationPersistent,
  resetAnimationForTest,
  getPreset,
  listBuiltinPresets,
  BUILTIN_PRESETS,
} from "./animation-state.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("animation-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetAnimationForTest();
    // mockReset clears the mockResolvedValueOnce queue — prevents
    // leftover one-shot values from leaking across tests.
    mocks.sendMessage.mockReset().mockResolvedValue({ message_id: 42 });
    mocks.editMessageText.mockReset().mockResolvedValue(undefined);
    mocks.deleteMessage.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetAnimationForTest();
    vi.useRealTimers();
  });

  // -- startAnimation -------------------------------------------------------

  describe("startAnimation", () => {
    it("sends the first frame as a message", async () => {
      await startAnimation(1, ["🔄", "🔃"]);

      expect(mocks.sendMessage).toHaveBeenCalledWith(123, "🔄", { parse_mode: "MarkdownV2", disable_notification: true });
    });

    it("returns the message_id of the sent message", async () => {
      const id = await startAnimation(1);
      expect(id).toBe(42);
    });

    it("sets animation as active", async () => {
      expect(isAnimationActive(1)).toBe(false);
      await startAnimation(1);
      expect(isAnimationActive(1)).toBe(true);
    });

    it("uses default frames when none provided", async () => {
      await startAnimation(1);
      const [chatId, text, opts] = mocks.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(chatId).toBe(123);
      expect(text).toMatch(/\u258e/); // ▎ delimiter — confirms default frames are used
      expect(opts).toEqual({ parse_mode: "MarkdownV2", disable_notification: true });
    });

    it("reuses existing message when starting new animation", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 });

      await startAnimation(1, ["A"]);
      expect(getAnimationMessageId(1)).toBe(42);

      await startAnimation(1, ["B"]);
      // Old message should have been edited in place, not deleted
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });
      expect(getAnimationMessageId(1)).toBe(42);
    });

    it("deletes orphan and sends new message when editMessageText fails on update", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      mocks.editMessageText.mockRejectedValueOnce(new Error("edit failed"));

      await startAnimation(1, ["A"]);
      await startAnimation(1, ["B"]);

      // Should have tried to delete the orphaned message
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      // Should have sent a new message since edit failed
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      expect(getAnimationMessageId(1)).toBe(55);
    });

    it("continues (sends new message) even if deleteMessage also fails on orphan cleanup", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      mocks.editMessageText.mockRejectedValueOnce(new Error("edit failed"));
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already deleted"));

      await startAnimation(1, ["A"]);
      // Should not throw even if both edit and delete fail
      await expect(startAnimation(1, ["B"])).resolves.toBe(55);
      expect(getAnimationMessageId(1)).toBe(55);
    });

    it("throws if resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValueOnce("not_a_number" as unknown as number);

      await expect(startAnimation(1)).rejects.toThrow("ALLOWED_USER_ID not configured");
    });

    it("sends with disable_notification: true by default (silent)", async () => {
      await startAnimation(1, ["X"]);
      const [, , opts] = mocks.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(opts.disable_notification).toBe(true);
    });

    it("sends with disable_notification: false when notify: true", async () => {
      await startAnimation(1, ["X"], 1000, 600, false, false, true);
      const [, , opts] = mocks.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(opts.disable_notification).toBe(false);
    });
  });

  // -- Frame cycling --------------------------------------------------------

  describe("frame cycling", () => {
    it("edits message text on interval", async () => {
      await startAnimation(1, ["A", "B", "C"], 2000);

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });

      // Second interval
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "C", { parse_mode: "MarkdownV2" });

      // Third interval wraps back to first
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "A", { parse_mode: "MarkdownV2" });
    });

    it("does not cycle with single frame", async () => {
      await startAnimation(1, ["only"], 2000);

      await vi.advanceTimersByTimeAsync(10000);
      // editMessageText should not be called for cycling (only potentially for cancel)
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("enforces minimum interval of 1000ms", async () => {
      await startAnimation(1, ["A", "B"], 200);

      // At 200ms — should not have cycled yet
      await vi.advanceTimersByTimeAsync(200);
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      // At 1000ms — should cycle
      await vi.advanceTimersByTimeAsync(800);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });
    });

    it("skips API call for identical consecutive frames", async () => {
      await startAnimation(1, ["A", "A", "A", "B"], 2000);

      // A→A: skip (no edit)
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      // A→A: skip again
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      // A→B: sends
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.editMessageText).toHaveBeenCalledOnce();
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });
    });

    it("stops animation on editMessageText failure during cycling", async () => {
      mocks.editMessageText.mockRejectedValueOnce(new Error("message not found"));
      await startAnimation(1, ["A", "B"], 2000);

      // First cycle fails — animation should be stopped
      await vi.advanceTimersByTimeAsync(2000);
      expect(isAnimationActive(1)).toBe(false);
    });
  });

  // -- 429 rate-limiting ----------------------------------------------------

  describe("429 rate-limiting", () => {
    function make429(retryAfter = 0): GrammyError {
      return new GrammyError(
        "Too Many Requests",
        { error_code: 429, ok: false, description: "retry after", parameters: { retry_after: retryAfter } },
        "editMessageText",
        {},
      );
    }

    it("two concurrent 429s create only one resume interval", async () => {
      // Set up editMessageText to hang (so two interval ticks fire before
      // either resolves), then fail with 429, then succeed afterward.
      let rejectFirst!: (e: unknown) => void;
      let rejectSecond!: (e: unknown) => void;
      mocks.editMessageText
        .mockImplementationOnce(() => new Promise((_, rej) => { rejectFirst = rej; }))
        .mockImplementationOnce(() => new Promise((_, rej) => { rejectSecond = rej; }))
        .mockResolvedValue(undefined);

      await startAnimation(1, ["A", "B"], 1000);

      // Advance 2000 ms — fires the cycle interval at t=1000 and t=2000.
      // Both cycleFrame calls are now in-flight (editMessageText is hanging).
      await vi.advanceTimersByTimeAsync(2000);

      // Deliver 429 errors to both in-flight frames.
      // With the fix, the second 429 handler clears the first resumeTimer
      // before scheduling its own — ensuring only one interval is created.
      rejectFirst(make429(0));
      rejectSecond(make429(0));

      // Flush microtasks (catch blocks) then fire resumeTimers (setTimeout 0 ms).
      // Use advanceTimersByTimeAsync(0) instead of runAllTimersAsync() to avoid
      // infinitely running the newly-created setInterval.
      await vi.advanceTimersByTimeAsync(0);

      mocks.editMessageText.mockClear();

      // Exactly one new cycleInterval should be running — one tick → one call
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    });
  });

  // -- cancelAnimation ------------------------------------------------------

  describe("cancelAnimation", () => {
    it("returns { cancelled: false } when no animation active", async () => {
      const result = await cancelAnimation(1);
      expect(result).toEqual({ cancelled: false });
    });

    it("returns {} after stopping active animation", async () => {
      await startAnimation(1);
      const result = await cancelAnimation(1);
      expect(result).toEqual({});
    });

    it("deletes the animation message when no replacement text", async () => {
      await startAnimation(1);
      await cancelAnimation(1);

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
    });

    it("replaces animation with text when provided", async () => {
      await startAnimation(1);
      const result = await cancelAnimation(1, "Done!", "Markdown");

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42,
        "Done\\!",
        expect.objectContaining({ parse_mode: "MarkdownV2" }),
      );
      expect(result).toEqual({ message_id: 42 });
    });

    it("calls clearSendInterceptor", async () => {
      await startAnimation(1);
      mocks.clearSendInterceptor.mockClear();
      await cancelAnimation(1);
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("does not delete when replacing with text", async () => {
      await startAnimation(1);
      await cancelAnimation(1, "Replaced");

      expect(mocks.deleteMessage).not.toHaveBeenCalledWith(123, 42);
    });

    it("sets isAnimationActive to false", async () => {
      await startAnimation(1);
      expect(isAnimationActive(1)).toBe(true);
      await cancelAnimation(1);
      expect(isAnimationActive(1)).toBe(false);
    });

    it("stops frame cycling", async () => {
      await startAnimation(1, ["A", "B"], 2000);
      await cancelAnimation(1);

      mocks.editMessageText.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      // No more cycling edits after cancel
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("handles editMessageText failure gracefully on replacement", async () => {
      mocks.editMessageText.mockRejectedValueOnce(new Error("msg deleted"));
      await startAnimation(1);
      const result = await cancelAnimation(1, "text", "Markdown");

      expect(result).toEqual({});
      expect(result.message_id).toBeUndefined();
    });

    it("handles deleteMessage failure gracefully", async () => {
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already deleted"));
      await startAnimation(1);

      // Should not throw
      const result = await cancelAnimation(1);
      expect(result).toEqual({});
    });

    it("prepends session name tag when buildHeader returns a header", async () => {
      const { buildHeader } = await import("./outbound-proxy.js");
      vi.mocked(buildHeader).mockReturnValueOnce({ plain: "Bot\n", formatted: "`Bot`\n" });

      await startAnimation(1);
      await cancelAnimation(1, "Done", "Markdown");

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42,
        "`Bot`\nDone",
        expect.objectContaining({ parse_mode: expect.any(String) }),
      );
    });
  });

  // -- getAnimationMessageId ------------------------------------------------

  describe("getAnimationMessageId", () => {
    it("returns null when no animation", () => {
      expect(getAnimationMessageId(1)).toBeNull();
    });

    it("returns message_id when animation is active", async () => {
      await startAnimation(1);
      expect(getAnimationMessageId(1)).toBe(42);
    });

    it("returns null after cancel", async () => {
      await startAnimation(1);
      await cancelAnimation(1);
      expect(getAnimationMessageId(1)).toBeNull();
    });
  });

  // -- resetAnimationForTest ------------------------------------------------

  describe("resetAnimationForTest", () => {
    it("clears state without API calls", async () => {
      await startAnimation(1);
      mocks.sendMessage.mockClear();
      mocks.editMessageText.mockClear();
      mocks.deleteMessage.mockClear();

      resetAnimationForTest();

      expect(isAnimationActive(1)).toBe(false);
      expect(getAnimationMessageId(1)).toBeNull();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });

    it("stops timers so no further cycling occurs", async () => {
      await startAnimation(1, ["A", "B"], 2000);
      resetAnimationForTest();

      mocks.editMessageText.mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });
  });

  // -- resetAnimationTimeout ------------------------------------------------

  describe("resetAnimationTimeout", () => {
    it("does nothing when no animation is active", () => {
      // Should not throw
      resetAnimationTimeout(1);
    });

    it("extends the auto-cancel timeout", async () => {
      await startAnimation(1, ["⏳"], 2000, 5); // 5 second timeout

      // Advance 4 seconds (just before timeout)
      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive(1)).toBe(true);

      // Reset the timeout
      resetAnimationTimeout(1);

      // Advance another 4 seconds (would have expired without reset)
      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive(1)).toBe(true);

      // Now let the full timeout expire from reset point
      await vi.advanceTimersByTimeAsync(1000);
      expect(isAnimationActive(1)).toBe(false);
    });
  });

  // -- Send interceptor (registered by startAnimation) ----------------------
  //
  // These tests capture the interceptor from registerSendInterceptor and
  // exercise every decision branch: position detection, mode (persistent
  // vs temporary), reply-markup bypass, atomicity, and error resilience.

  describe("send interceptor — registration", () => {
    it("registers interceptor on startAnimation", async () => {
      await startAnimation(1, ["A"]);
      expect(mocks.registerSendInterceptor).toHaveBeenCalledOnce();
      expect(mocks.registerSendInterceptor).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          beforeTextSend: expect.any(Function),
          afterTextSend: expect.any(Function),
          beforeFileSend: expect.any(Function),
          afterFileSend: expect.any(Function),
          onEdit: expect.any(Function),
        }),
      );
    });

    it("onEdit resets animation timeout", async () => {
      await startAnimation(1, ["⏳"], 2000, 5); // 5s timeout
      const interceptor = mocks.registerSendInterceptor.mock.calls[0][1];

      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive(1)).toBe(true);

      interceptor.onEdit();

      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive(1)).toBe(true);

      await vi.advanceTimersByTimeAsync(1000);
      expect(isAnimationActive(1)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // TEMPORARY MODE — beforeTextSend position detection
  // -----------------------------------------------------------------------

  describe("send interceptor — temporary mode", () => {
    /** Helper: start a temporary animation and return the interceptor. */
    async function tempAnim(msgId = 42) {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: msgId });
      await startAnimation(1, ["⏳"], 1000, 120, false);
      return mocks.registerSendInterceptor.mock.calls.at(-1)![1];
    }

    it("edits in-place when animation IS the last message (exact match)", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "Done", {});

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42, "Done", {},
      );
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
      expect(result).toEqual({ intercepted: true, message_id: 42 });
      expect(isAnimationActive(1)).toBe(false);
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("edits in-place when animation msgId > highwater (still last)", async () => {
      // Edge: highwater hasn't caught up (e.g. trackMessageId
      // was called but store hasn't processed yet). >= handles this.
      mocks.getHighestMessageId.mockReturnValue(40);
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42, "text", {},
      );
      expect(result).toEqual({ intercepted: true, message_id: 42 });
    });

    it("deletes when user message pushed animation up (highwater > animId)", async () => {
      mocks.getHighestMessageId.mockReturnValue(43);
      const int = await tempAnim(42);
      mocks.clearSendInterceptor.mockClear();

      const result = await int.beforeTextSend(123, "text", {});

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(result).toEqual({ intercepted: false });
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("deletes when many user messages arrived (highwater >> animId)", async () => {
      mocks.getHighestMessageId.mockReturnValue(99);
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(result).toEqual({ intercepted: false });
    });

    it("falls back to not-intercepted when edit throws (msg deleted externally)", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.editMessageText.mockRejectedValueOnce(new Error("Bad Request: message to edit not found"));
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42); // must clean up even on edit failure
      expect(result).toEqual({ intercepted: false });
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("handles delete failure gracefully after R4 edit failure", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.editMessageText.mockRejectedValueOnce(new Error("message to edit not found"));
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already gone"));
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(result).toEqual({ intercepted: false }); // cosmetic failure — still clean exit
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("delete failure is cosmetic — still returns not-intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(50);
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already gone"));
      const int = await tempAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(result).toEqual({ intercepted: false });
    });

    it("does NOT restart after one-shot promotion", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      const int = await tempAnim(42);

      await int.beforeTextSend(123, "Done", {});
      mocks.sendMessage.mockClear();
      await int.afterTextSend!();

      // No restart — temporary is one-shot
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(isAnimationActive(1)).toBe(false);
    });

    it("does NOT restart after one-shot file send", async () => {
      const int = await tempAnim(42);

      await int.beforeFileSend();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();

      mocks.sendMessage.mockClear();
      await int.afterFileSend();

      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(isAnimationActive(1)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // REPLY-PARAMETERS BYPASS (reply threading can't be added via edit)
  // -----------------------------------------------------------------------

  describe("send interceptor — reply parameters bypass", () => {
    it("temporary: deletes animation and returns not-intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      const result = await int.beforeTextSend(123, "Reply text", {
        reply_parameters: { message_id: 10 },
      });

      expect(result).toEqual({ intercepted: false });
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive(1)).toBe(false);
    });

    it("persistent: deletes animation, saves for resume", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["⏳"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      const result = await int.beforeTextSend(123, "Reply text", {
        reply_parameters: { message_id: 10 },
      });

      expect(result).toEqual({ intercepted: false });
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive(1)).toBe(false);
    });

    it("reply_markup edits in place (keyboards are fine)", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      const result = await int.beforeTextSend(123, "Pick one", {
        reply_markup: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] },
      });

      expect(result).toEqual({ intercepted: true, message_id: 42 });
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "Pick one", {
        reply_markup: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] },
      });
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });

    it("null reply_markup does NOT bypass", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      const result = await int.beforeTextSend(123, "text", {
        reply_markup: null,
      });

      // null reply_markup should NOT trigger the bypass
      expect(result).toEqual({ intercepted: true, message_id: 42 });
    });
  });

  // -----------------------------------------------------------------------
  // PERSISTENT MODE — edit in place + inline/deferred restart
  // -----------------------------------------------------------------------

  describe("send interceptor — persistent mode", () => {
    /** Helper: start a persistent animation and return the interceptor. */
    async function persAnim(msgId = 42) {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: msgId });
      await startAnimation(1, ["⏳", "⌛"], 1000, 120, true);
      return mocks.registerSendInterceptor.mock.calls.at(-1)![1];
    }

    it("edits in place when last message (R4) + restarts inline", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })   // initial
        .mockResolvedValueOnce({ message_id: 50 });   // inline restart
      const int = await persAnim(42);

      const result = await int.beforeTextSend(123, "Content", {});

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42, "Content", {},
      );
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
      expect(result).toEqual({ intercepted: true, message_id: 42 });
      // Animation restarted inline below the promoted message
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(50);
    });

    it("deletes + deferred restart when NOT last message", async () => {
      mocks.getHighestMessageId.mockReturnValue(99);
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 60 });
      const int = await persAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(result).toEqual({ intercepted: false });

      // Deferred restart via afterTextSend
      await int.afterTextSend!();
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(60);
    });

    it("falls back to deferred restart when edit fails (last message)", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.editMessageText.mockRejectedValueOnce(new Error("msg gone"));
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      const int = await persAnim(42);

      const result = await int.beforeTextSend(123, "text", {});
      // Edit failed — proxy sends normally, then afterTextSend restarts
      expect(result).toEqual({ intercepted: false });

      await int.afterTextSend!();
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(55);
    });

    it("delete failure is cosmetic — still saves for deferred restart", async () => {
      mocks.getHighestMessageId.mockReturnValue(99);
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already gone"));
      const int = await persAnim(42);

      const result = await int.beforeTextSend(123, "text", {});
      expect(result).toEqual({ intercepted: false });

      await int.afterTextSend!();
      expect(isAnimationActive(1)).toBe(true);
    });

    it("file send: suspend → resume cycle", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 50 });
      const int = await persAnim(42);

      await int.beforeFileSend();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive(1)).toBe(false);

      await int.afterFileSend();
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(50);
    });

    it("file send delete failure is cosmetic — still resumes", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      mocks.deleteMessage.mockRejectedValueOnce(new Error("gone"));
      const int = await persAnim(42);

      await int.beforeFileSend();
      await int.afterFileSend();
      expect(isAnimationActive(1)).toBe(true);
    });

    it("inline restart failure is cosmetic — still returns intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockRejectedValueOnce(new Error("Telegram down"));
      const int = await persAnim(42);

      const result = await int.beforeTextSend(123, "text", {});

      // Edit succeeded, restart failed — still intercepted
      expect(result).toEqual({ intercepted: true, message_id: 42 });
      expect(isAnimationActive(1)).toBe(false);
    });

    it("isAnimationPersistent returns true", async () => {
      await persAnim(42);
      expect(isAnimationPersistent(1)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // ATOMIC CAPTURE — re-entrancy safety
  // -----------------------------------------------------------------------

  describe("send interceptor — atomic capture", () => {
    it("second beforeTextSend sees null state → not intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      // First call captures and clears _state
      const r1 = await int.beforeTextSend(123, "first", {});
      expect(r1).toEqual({ intercepted: true, message_id: 42 });

      // Second call — state is null, returns not-intercepted
      const r2 = await int.beforeTextSend(123, "second", {});
      expect(r2).toEqual({ intercepted: false });
    });

    it("afterTextSend is one-shot — second call is no-op", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 50 });
      await startAnimation(1, ["A"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      await int.beforeTextSend(123, "text", {});
      await int.afterTextSend!();
      expect(isAnimationActive(1)).toBe(true);

      // Reset to track second call
      resetAnimationForTest();
      mocks.sendMessage.mockClear();

      await int.afterTextSend!();
      // No sendMessage — resume config was already consumed
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it("afterFileSend is one-shot — second call is no-op", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 50 });
      await startAnimation(1, ["A"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      await int.beforeFileSend();
      await int.afterFileSend();

      // Reset to track second call
      resetAnimationForTest();
      mocks.sendMessage.mockClear();

      await int.afterFileSend();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it("beforeTextSend after cancelAnimation returns not-intercepted", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["A"]);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      await cancelAnimation(1);

      const result = await int.beforeTextSend(123, "text", {});
      expect(result).toEqual({ intercepted: false });
    });

    it("beforeFileSend after cancelAnimation is no-op", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(1, ["A"]);
      const int = mocks.registerSendInterceptor.mock.calls[0][1];

      await cancelAnimation(1);
      mocks.deleteMessage.mockClear();

      await int.beforeFileSend();
      // No delete — state was already null
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });
  });

  // -- Auto-timeout ---------------------------------------------------------

  describe("auto-timeout", () => {
    it("cancels animation after timeout expires", async () => {
      await startAnimation(1, ["⏳"], 2000, 3); // 3 second timeout

      expect(isAnimationActive(1)).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(isAnimationActive(1)).toBe(false);
    });

    it("deletes message on auto-timeout", async () => {
      await startAnimation(1, ["⏳"], 2000, 2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
    });

    it("caps timeout at 600 seconds", async () => {
      await startAnimation(1, ["⏳"], 2000, 9999);

      // At 600 seconds it should auto-cancel
      await vi.advanceTimersByTimeAsync(600_000);
      expect(isAnimationActive(1)).toBe(false);
    });
  });

  // -- Space normalisation --------------------------------------------------

  describe("space normalisation", () => {
    it("replaces regular spaces with NBSP in frame text by default", async () => {
      await startAnimation(1, ["A B"]);
      // U+00A0 (NBSP) replaces the space before MarkdownV2 processing
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A\u00A0B",
        { parse_mode: "MarkdownV2", disable_notification: true },
      );
    });

    it("leaves spaces unchanged when allowBreakingSpaces is true", async () => {
      await startAnimation(1, ["A B"], 1000, 120, false, true);
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A B",
        { parse_mode: "MarkdownV2", disable_notification: true },
      );
    });

    it("normalises spaces before computing padding lengths", async () => {
      // "A " vs "AB" — after normalisation both become len 2, no padding added
      await startAnimation(1, ["A ", "AB"], 1000, 120, false, false);
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A\u00A0",
        { parse_mode: "MarkdownV2", disable_notification: true },
      );
    });
  });

  // -- Built-in presets -----------------------------------------------------

  describe("built-in presets", () => {
    it("getPreset returns frames for built-in keys", () => {
      expect(getPreset(1, "bounce")).toBeDefined();
      expect(getPreset(1, "dots")).toBeDefined();
      expect(getPreset(1, "working")).toBeDefined();
      expect(getPreset(1, "thinking")).toBeDefined();
      expect(getPreset(1, "loading")).toBeDefined();
    });

    it("getPreset returns undefined for unknown key", () => {
      expect(getPreset(1, "nonexistent_preset_xyz")).toBeUndefined();
    });

    it("listBuiltinPresets returns all built-in keys", () => {
      const keys = listBuiltinPresets();
      expect(keys).toContain("bounce");
      expect(keys).toContain("dots");
      expect(keys).toContain("working");
      expect(keys).toContain("thinking");
      expect(keys).toContain("loading");
      expect(keys).toHaveLength(BUILTIN_PRESETS.size);
    });

    it("getPreset session preset shadows built-in with same key", async () => {
      const { registerPreset } = await import("./animation-state.js");
      const customFrames = ["custom1", "custom2"];
      registerPreset(1, "bounce", customFrames);
      expect(getPreset(1, "bounce")).toEqual(customFrames);
    });
  });

  // -- Priority Stack (multi-session) -----------------------------------------

  describe("priority stack — multi-session", () => {
    it("same priority: more recently added SID is displayed", async () => {
      await startAnimation(1, ["A"], 1000, 60);  // SID 1, priority 0, seq 1
      await startAnimation(2, ["B"], 1000, 60);  // SID 2, priority 0, seq 2 (more recent → wins)

      // SID 2 is on top (more recent), SID 1 is buried
      expect(isAnimationActive(1)).toBe(true);     // buried but active
      expect(isAnimationActive(2)).toBe(true);     // on top
      expect(getAnimationMessageId(1)).toBeNull(); // buried
      expect(getAnimationMessageId(2)).toBe(42);   // displayed

      // Only one Telegram message created; SID 2 took over by editing it
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", expect.anything());
    });

    it("higher priority: higher-priority SID stays on top regardless of insertion order", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1, priority 5 → top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // SID 2, priority 0 → buried

      expect(isAnimationActive(1)).toBe(true);
      expect(isAnimationActive(2)).toBe(true);      // buried
      expect(getAnimationMessageId(1)).toBe(42);    // displayed
      expect(getAnimationMessageId(2)).toBeNull();  // buried

      // No edit — SID 1 was already displayed when SID 2 pushed
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("cascade: top times out → buried SID takes over display", async () => {
      await startAnimation(1, ["A"], 1000, 60);  // SID 1, seq 1 (will be buried)
      await startAnimation(2, ["B"], 1000, 5);   // SID 2, seq 2, 5s timeout (takes top)

      expect(getAnimationMessageId(2)).toBe(42);
      expect(getAnimationMessageId(1)).toBeNull();

      mocks.editMessageText.mockClear();

      // Advance past SID 2's timeout → cascade to SID 1
      await vi.advanceTimersByTimeAsync(5000);

      expect(isAnimationActive(2)).toBe(false);
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(42);  // same Telegram message reused

      // editMessageText called to switch display to SID 1's frame "A"
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "A", expect.anything());
    });

    it("cancel buried entry: removes only that entry, displayed unchanged", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1, high priority → top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // SID 2, low priority → buried

      expect(getAnimationMessageId(1)).toBe(42);
      expect(getAnimationMessageId(2)).toBeNull();

      mocks.deleteMessage.mockClear();
      mocks.editMessageText.mockClear();

      const result = await cancelAnimation(2);

      expect(result).toEqual({});
      expect(isAnimationActive(2)).toBe(false);
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(42);    // still displayed
      expect(mocks.deleteMessage).not.toHaveBeenCalled();  // no Telegram deletion
      expect(mocks.editMessageText).not.toHaveBeenCalled(); // display unchanged
    });

    it("timeout while buried: entry becomes inactive, display unchanged", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1, high priority → top
      await startAnimation(2, ["B"], 1000, 3, false, false, false, 0);   // SID 2, 3s timeout → buried

      expect(isAnimationActive(2)).toBe(true);  // buried but active

      await vi.advanceTimersByTimeAsync(3100);

      // SID 2 wall-clock expired → isAnimationActive returns false
      expect(isAnimationActive(2)).toBe(false);
      // SID 1 still displayed (unaffected)
      expect(isAnimationActive(1)).toBe(true);
      expect(getAnimationMessageId(1)).toBe(42);
    });

    it("isAnimationActive returns true for buried sessions", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1 top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // SID 2 buried

      expect(isAnimationActive(1)).toBe(true);  // top
      expect(isAnimationActive(2)).toBe(true);  // buried but active
    });

    it("getAnimationMessageId returns null for buried session", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // buried

      expect(getAnimationMessageId(1)).toBe(42);
      expect(getAnimationMessageId(2)).toBeNull();
    });

    it("push replaces own entry: updated priority takes effect", async () => {
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 5);  // SID 2, priority 5 → top
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 0);  // SID 1, priority 0 → buried

      expect(getAnimationMessageId(2)).toBe(42);
      expect(getAnimationMessageId(1)).toBeNull();

      mocks.editMessageText.mockClear();

      // SID 1 re-pushes with higher priority → takes top
      await startAnimation(1, ["A2"], 1000, 60, false, false, false, 10);

      expect(getAnimationMessageId(1)).toBe(42);   // SID 1 now on top
      expect(getAnimationMessageId(2)).toBeNull(); // SID 2 now buried
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "A2", expect.anything());
    });

    it("stack empty after all entries removed: animation deleted", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1 top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // SID 2 buried

      await cancelAnimation(1);  // SID 1 cancelled → cascade to SID 2
      await cancelAnimation(2);  // SID 2 now on top → cancel → stack empty

      expect(isAnimationActive(1)).toBe(false);
      expect(isAnimationActive(2)).toBe(false);
    });

    it("buried session beforeTextSend is not intercepted", async () => {
      await startAnimation(1, ["A"], 1000, 60, false, false, false, 5);  // SID 1 top
      await startAnimation(2, ["B"], 1000, 60, false, false, false, 0);  // SID 2 buried

      // Find SID 2's interceptor registration
      const calls = mocks.registerSendInterceptor.mock.calls as Array<[number, { beforeTextSend: (...a: unknown[]) => unknown }]>;
      const sid2Call = calls.find(([sid]) => sid === 2);
      expect(sid2Call).toBeDefined();
      const sid2Int = sid2Call![1];

      mocks.getHighestMessageId.mockReturnValue(0);
      const result = await sid2Int.beforeTextSend(123, "hello", {});

      // Buried SID — not intercepted, displayed animation unchanged
      expect(result).toEqual({ intercepted: false });
      expect(getAnimationMessageId(1)).toBe(42);
    });

    it("cascade after R4 text-promotion: buried session resumes with new message", async () => {
      // SID 2 at priority 0 → initial display (msg 42)
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })  // SID 2 initial
        .mockResolvedValueOnce({ message_id: 99 }); // SID 2 cascaded
      await startAnimation(2, ["think"], 1000, 60, false, false, false, 0);
      expect(getAnimationMessageId(2)).toBe(42);

      // SID 1 at priority 1 → takes over display by editing msg 42
      await startAnimation(1, ["work"], 1000, 60, false, false, false, 1);
      expect(getAnimationMessageId(1)).toBe(42);
      expect(getAnimationMessageId(2)).toBeNull();  // buried

      // Get SID 1's registered interceptor
      const calls = mocks.registerSendInterceptor.mock.calls as Array<[number, { beforeTextSend: (...a: unknown[]) => unknown }]>;
      const sid1Int = calls.find(([sid]) => sid === 1)![1];

      mocks.editMessageText.mockClear();
      mocks.getHighestMessageId.mockReturnValue(42);  // animation is last msg → R4 path

      // SID 1 sends text → R4: edits msg 42 in place with real text
      const result = await sid1Int.beforeTextSend(123, "hello", {});

      expect(result).toEqual({ intercepted: true, message_id: 42 });
      // R4 promoted text into animation slot
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "hello", expect.anything());
      // Cascade created a new message for SID 2
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      expect(isAnimationActive(2)).toBe(true);
      expect(getAnimationMessageId(2)).toBe(99);
    });

    it("cascade after R5 text-send: buried session resumes with new message", async () => {
      // SID 2 at priority 0 → initial display (msg 42)
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })  // SID 2 initial
        .mockResolvedValueOnce({ message_id: 99 }); // SID 2 cascaded
      await startAnimation(2, ["think"], 1000, 60, false, false, false, 0);

      // SID 1 at priority 1 → takes over display
      await startAnimation(1, ["work"], 1000, 60, false, false, false, 1);

      const calls = mocks.registerSendInterceptor.mock.calls as Array<[number, { beforeTextSend: (...a: unknown[]) => unknown }]>;
      const sid1Int = calls.find(([sid]) => sid === 1)![1];

      mocks.deleteMessage.mockClear();
      mocks.getHighestMessageId.mockReturnValue(999);  // newer messages exist → R5 path

      // SID 1 sends text → R5: deletes animation + lets proxy send normally
      const result = await sid1Int.beforeTextSend(123, "hello", {});

      expect(result).toEqual({ intercepted: false });
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      // Cascade created a new message for SID 2
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      expect(isAnimationActive(2)).toBe(true);
      expect(getAnimationMessageId(2)).toBe(99);
    });

    it("cancel cascaded animation: works normally after higher-priority consumer", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })  // SID 2 initial
        .mockResolvedValueOnce({ message_id: 99 }); // SID 2 cascaded after SID 1 consumes
      await startAnimation(2, ["think"], 1000, 60, false, false, false, 0);
      await startAnimation(1, ["work"], 1000, 60, false, false, false, 1);

      const calls = mocks.registerSendInterceptor.mock.calls as Array<[number, { beforeTextSend: (...a: unknown[]) => unknown }]>;
      const sid1Int = calls.find(([sid]) => sid === 1)![1];

      mocks.getHighestMessageId.mockReturnValue(42);
      await sid1Int.beforeTextSend(123, "hello", {});  // R4 promotes, SID 2 cascades to msg 99

      expect(getAnimationMessageId(2)).toBe(99);

      // Now cancel SID 2's cascaded animation
      mocks.deleteMessage.mockClear();
      const cancelResult = await cancelAnimation(2);

      expect(cancelResult).toEqual({});
      expect(isAnimationActive(2)).toBe(false);
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 99);
    });
  });
});
