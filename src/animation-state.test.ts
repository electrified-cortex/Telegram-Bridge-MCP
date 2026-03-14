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
  const actual = await importActual<typeof import("./telegram.js")>();
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
}));

vi.mock("./message-store.js", () => ({
  recordOutgoing: vi.fn(),
  getHighestMessageId: mocks.getHighestMessageId,
  trackMessageId: vi.fn(),
}));

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
      await startAnimation(["🔄", "🔃"]);

      expect(mocks.sendMessage).toHaveBeenCalledWith(123, "🔄", { parse_mode: "MarkdownV2" });
    });

    it("returns the message_id of the sent message", async () => {
      const id = await startAnimation();
      expect(id).toBe(42);
    });

    it("sets animation as active", async () => {
      expect(isAnimationActive()).toBe(false);
      await startAnimation();
      expect(isAnimationActive()).toBe(true);
    });

    it("uses default frames when none provided", async () => {
      await startAnimation();
      const [chatId, text, opts] = mocks.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(chatId).toBe(123);
      expect(text).toMatch(/\u258e/); // ▎ delimiter — confirms default frames are used
      expect(opts).toEqual({ parse_mode: "MarkdownV2" });
    });

    it("reuses existing message when starting new animation", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 });

      await startAnimation(["A"]);
      expect(getAnimationMessageId()).toBe(42);

      await startAnimation(["B"]);
      // Old message should have been edited in place, not deleted
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });
      expect(getAnimationMessageId()).toBe(42);
    });

    it("throws if resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValueOnce("not_a_number" as unknown as number);

      await expect(startAnimation()).rejects.toThrow("ALLOWED_USER_ID not configured");
    });
  });

  // -- Frame cycling --------------------------------------------------------

  describe("frame cycling", () => {
    it("edits message text on interval", async () => {
      await startAnimation(["A", "B", "C"], 2000);

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
      await startAnimation(["only"], 2000);

      await vi.advanceTimersByTimeAsync(10000);
      // editMessageText should not be called for cycling (only potentially for cancel)
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("enforces minimum interval of 1000ms", async () => {
      await startAnimation(["A", "B"], 200);

      // At 200ms — should not have cycled yet
      await vi.advanceTimersByTimeAsync(200);
      expect(mocks.editMessageText).not.toHaveBeenCalled();

      // At 1000ms — should cycle
      await vi.advanceTimersByTimeAsync(800);
      expect(mocks.editMessageText).toHaveBeenCalledWith(123, 42, "B", { parse_mode: "MarkdownV2" });
    });

    it("skips API call for identical consecutive frames", async () => {
      await startAnimation(["A", "A", "A", "B"], 2000);

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
      await startAnimation(["A", "B"], 2000);

      // First cycle fails — animation should be stopped
      await vi.advanceTimersByTimeAsync(2000);
      expect(isAnimationActive()).toBe(false);
    });
  });

  // -- cancelAnimation ------------------------------------------------------

  describe("cancelAnimation", () => {
    it("returns { cancelled: false } when no animation active", async () => {
      const result = await cancelAnimation();
      expect(result).toEqual({ cancelled: false });
    });

    it("returns { cancelled: true } after stopping active animation", async () => {
      await startAnimation();
      const result = await cancelAnimation();
      expect(result).toEqual({ cancelled: true });
    });

    it("deletes the animation message when no replacement text", async () => {
      await startAnimation();
      await cancelAnimation();

      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
    });

    it("replaces animation with text when provided", async () => {
      await startAnimation();
      const result = await cancelAnimation("Done!", "Markdown");

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123, 42,
        expect.any(String),
        expect.objectContaining({ parse_mode: expect.any(String) }),
      );
      expect(result).toEqual({ cancelled: true, message_id: 42 });
    });

    it("calls clearSendInterceptor", async () => {
      await startAnimation();
      mocks.clearSendInterceptor.mockClear();
      await cancelAnimation();
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();
    });

    it("does not delete when replacing with text", async () => {
      await startAnimation();
      await cancelAnimation("Replaced");

      expect(mocks.deleteMessage).not.toHaveBeenCalledWith(123, 42);
    });

    it("sets isAnimationActive to false", async () => {
      await startAnimation();
      expect(isAnimationActive()).toBe(true);
      await cancelAnimation();
      expect(isAnimationActive()).toBe(false);
    });

    it("stops frame cycling", async () => {
      await startAnimation(["A", "B"], 2000);
      await cancelAnimation();

      mocks.editMessageText.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      // No more cycling edits after cancel
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("handles editMessageText failure gracefully on replacement", async () => {
      mocks.editMessageText.mockRejectedValueOnce(new Error("msg deleted"));
      await startAnimation();
      const result = await cancelAnimation("text", "Markdown");

      expect(result).toEqual({ cancelled: true });
      expect(result.message_id).toBeUndefined();
    });

    it("handles deleteMessage failure gracefully", async () => {
      mocks.deleteMessage.mockRejectedValueOnce(new Error("already deleted"));
      await startAnimation();

      // Should not throw
      const result = await cancelAnimation();
      expect(result).toEqual({ cancelled: true });
    });
  });

  // -- getAnimationMessageId ------------------------------------------------

  describe("getAnimationMessageId", () => {
    it("returns null when no animation", () => {
      expect(getAnimationMessageId()).toBeNull();
    });

    it("returns message_id when animation is active", async () => {
      await startAnimation();
      expect(getAnimationMessageId()).toBe(42);
    });

    it("returns null after cancel", async () => {
      await startAnimation();
      await cancelAnimation();
      expect(getAnimationMessageId()).toBeNull();
    });
  });

  // -- resetAnimationForTest ------------------------------------------------

  describe("resetAnimationForTest", () => {
    it("clears state without API calls", async () => {
      await startAnimation();
      mocks.sendMessage.mockClear();
      mocks.editMessageText.mockClear();
      mocks.deleteMessage.mockClear();

      resetAnimationForTest();

      expect(isAnimationActive()).toBe(false);
      expect(getAnimationMessageId()).toBeNull();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });

    it("stops timers so no further cycling occurs", async () => {
      await startAnimation(["A", "B"], 2000);
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
      resetAnimationTimeout();
    });

    it("extends the auto-cancel timeout", async () => {
      await startAnimation(["⏳"], 2000, 5); // 5 second timeout

      // Advance 4 seconds (just before timeout)
      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive()).toBe(true);

      // Reset the timeout
      resetAnimationTimeout();

      // Advance another 4 seconds (would have expired without reset)
      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive()).toBe(true);

      // Now let the full timeout expire from reset point
      await vi.advanceTimersByTimeAsync(1000);
      expect(isAnimationActive()).toBe(false);
    });
  });

  // -- Send interceptor (registered by startAnimation) ----------------------
  //
  // These tests capture the interceptor from registerSendInterceptor and
  // exercise every decision branch: position detection, mode (persistent
  // vs temporary), reply-markup bypass, atomicity, and error resilience.

  describe("send interceptor — registration", () => {
    it("registers interceptor on startAnimation", async () => {
      await startAnimation(["A"]);
      expect(mocks.registerSendInterceptor).toHaveBeenCalledOnce();
      expect(mocks.registerSendInterceptor).toHaveBeenCalledWith(
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
      await startAnimation(["⏳"], 2000, 5); // 5s timeout
      const interceptor = mocks.registerSendInterceptor.mock.calls[0][0];

      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive()).toBe(true);

      interceptor.onEdit();

      await vi.advanceTimersByTimeAsync(4000);
      expect(isAnimationActive()).toBe(true);

      await vi.advanceTimersByTimeAsync(1000);
      expect(isAnimationActive()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // TEMPORARY MODE — beforeTextSend position detection
  // -----------------------------------------------------------------------

  describe("send interceptor — temporary mode", () => {
    /** Helper: start a temporary animation and return the interceptor. */
    async function tempAnim(msgId = 42) {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: msgId });
      await startAnimation(["⏳"], 1000, 120, false);
      return mocks.registerSendInterceptor.mock.calls.at(-1)![0];
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
      expect(isAnimationActive()).toBe(false);
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

      expect(result).toEqual({ intercepted: false });
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
      expect(isAnimationActive()).toBe(false);
    });

    it("does NOT restart after one-shot file send", async () => {
      const int = await tempAnim(42);

      await int.beforeFileSend();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(mocks.clearSendInterceptor).toHaveBeenCalled();

      mocks.sendMessage.mockClear();
      await int.afterFileSend();

      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(isAnimationActive()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // REPLY-PARAMETERS BYPASS (reply threading can't be added via edit)
  // -----------------------------------------------------------------------

  describe("send interceptor — reply parameters bypass", () => {
    it("temporary: deletes animation and returns not-intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

      const result = await int.beforeTextSend(123, "Reply text", {
        reply_parameters: { message_id: 10 },
      });

      expect(result).toEqual({ intercepted: false });
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive()).toBe(false);
    });

    it("persistent: deletes animation, saves for resume", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(["⏳"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

      const result = await int.beforeTextSend(123, "Reply text", {
        reply_parameters: { message_id: 10 },
      });

      expect(result).toEqual({ intercepted: false });
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive()).toBe(false);
    });

    it("reply_markup edits in place (keyboards are fine)", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

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
      await startAnimation(["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

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
      await startAnimation(["⏳", "⌛"], 1000, 120, true);
      return mocks.registerSendInterceptor.mock.calls.at(-1)![0];
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
      expect(isAnimationActive()).toBe(true);
      expect(getAnimationMessageId()).toBe(50);
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
      expect(isAnimationActive()).toBe(true);
      expect(getAnimationMessageId()).toBe(60);
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
      expect(isAnimationActive()).toBe(true);
      expect(getAnimationMessageId()).toBe(55);
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
      expect(isAnimationActive()).toBe(true);
    });

    it("file send: suspend → resume cycle", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 50 });
      const int = await persAnim(42);

      await int.beforeFileSend();
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
      expect(isAnimationActive()).toBe(false);

      await int.afterFileSend();
      expect(isAnimationActive()).toBe(true);
      expect(getAnimationMessageId()).toBe(50);
    });

    it("file send delete failure is cosmetic — still resumes", async () => {
      mocks.sendMessage
        .mockResolvedValueOnce({ message_id: 42 })
        .mockResolvedValueOnce({ message_id: 55 });
      mocks.deleteMessage.mockRejectedValueOnce(new Error("gone"));
      const int = await persAnim(42);

      await int.beforeFileSend();
      await int.afterFileSend();
      expect(isAnimationActive()).toBe(true);
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
      expect(isAnimationActive()).toBe(false);
    });

    it("isAnimationPersistent returns true", async () => {
      await persAnim(42);
      expect(isAnimationPersistent()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // ATOMIC CAPTURE — re-entrancy safety
  // -----------------------------------------------------------------------

  describe("send interceptor — atomic capture", () => {
    it("second beforeTextSend sees null state → not intercepted", async () => {
      mocks.getHighestMessageId.mockReturnValue(42);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(["⏳"], 1000, 120, false);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

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
      await startAnimation(["A"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

      await int.beforeTextSend(123, "text", {});
      await int.afterTextSend!();
      expect(isAnimationActive()).toBe(true);

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
      await startAnimation(["A"], 1000, 120, true);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

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
      await startAnimation(["A"]);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

      await cancelAnimation();

      const result = await int.beforeTextSend(123, "text", {});
      expect(result).toEqual({ intercepted: false });
    });

    it("beforeFileSend after cancelAnimation is no-op", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 42 });
      await startAnimation(["A"]);
      const int = mocks.registerSendInterceptor.mock.calls[0][0];

      await cancelAnimation();
      mocks.deleteMessage.mockClear();

      await int.beforeFileSend();
      // No delete — state was already null
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });
  });

  // -- Auto-timeout ---------------------------------------------------------

  describe("auto-timeout", () => {
    it("cancels animation after timeout expires", async () => {
      await startAnimation(["⏳"], 2000, 3); // 3 second timeout

      expect(isAnimationActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(isAnimationActive()).toBe(false);
    });

    it("deletes message on auto-timeout", async () => {
      await startAnimation(["⏳"], 2000, 2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, 42);
    });

    it("caps timeout at 600 seconds", async () => {
      await startAnimation(["⏳"], 2000, 9999);

      // At 600 seconds it should auto-cancel
      await vi.advanceTimersByTimeAsync(600_000);
      expect(isAnimationActive()).toBe(false);
    });
  });

  // -- Space normalisation --------------------------------------------------

  describe("space normalisation", () => {
    it("replaces regular spaces with NBSP in frame text by default", async () => {
      await startAnimation(["A B"]);
      // U+00A0 (NBSP) replaces the space before MarkdownV2 processing
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A\u00A0B",
        { parse_mode: "MarkdownV2" },
      );
    });

    it("leaves spaces unchanged when allowBreakingSpaces is true", async () => {
      await startAnimation(["A B"], 1000, 120, false, true);
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A B",
        { parse_mode: "MarkdownV2" },
      );
    });

    it("normalises spaces before computing padding lengths", async () => {
      // "A " vs "AB" — after normalisation both become len 2, no padding added
      await startAnimation(["A ", "AB"], 1000, 120, false, false);
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        "A\u00A0",
        { parse_mode: "MarkdownV2" },
      );
    });
  });

  // -- Built-in presets -----------------------------------------------------

  describe("built-in presets", () => {
    it("getPreset returns frames for built-in keys", () => {
      expect(getPreset("bounce")).toBeDefined();
      expect(getPreset("dots")).toBeDefined();
      expect(getPreset("working")).toBeDefined();
      expect(getPreset("thinking")).toBeDefined();
      expect(getPreset("loading")).toBeDefined();
    });

    it("getPreset returns undefined for unknown key", () => {
      expect(getPreset("nonexistent_preset_xyz")).toBeUndefined();
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
      registerPreset("bounce", customFrames);
      expect(getPreset("bounce")).toEqual(customFrames);
    });
  });
});
