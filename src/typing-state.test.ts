import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "./telegram.js";

const mocks = vi.hoisted(() => ({
  sendChatAction: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 123),
  fireTempReactionRestore: vi.fn().mockResolvedValue(undefined),
  isAnimationActive: vi.fn(() => false),
  isAnimationPersistent: vi.fn(() => false),
  cancelAnimation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./temp-reaction.js", () => ({
  fireTempReactionRestore: mocks.fireTempReactionRestore,
}));

vi.mock("./animation-state.js", () => ({
  isAnimationActive: () => mocks.isAnimationActive(),
  isAnimationPersistent: () => mocks.isAnimationPersistent(),
  cancelAnimation: () => mocks.cancelAnimation(),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

import {
  showTyping,
  cancelTyping,
  isTypingActive,
  typingGeneration,
  cancelTypingIfSameGeneration,
  pauseTypingEmission,
  resumeTypingEmission,
  isChatSuppressedForTest,
  resetTypingSuppressionForTest,
  suppressedChatActionForTest,
} from "./typing-state.js";

describe("typing-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelTyping();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelTyping();
    vi.useRealTimers();
  });

  describe("cancelTyping", () => {
    it("returns false when nothing is active", () => {
      expect(cancelTyping()).toBe(false);
    });

    it("returns true when indicator was active", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(10);
      expect(cancelTyping()).toBe(true);
    });

    it("sets isTypingActive to false", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(10);
      cancelTyping();
      expect(isTypingActive()).toBe(false);
    });
  });

  describe("showTyping", () => {
    it("returns false if resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValueOnce({ code: "UNAUTHORIZED_CHAT", message: "test" });
      const result = await showTyping(5);
      expect(result).toBe(false);
      expect(isTypingActive()).toBe(false);
    });

    it("returns false and stays inactive if sendChatAction throws", async () => {
      mocks.sendChatAction.mockRejectedValueOnce(new Error("fail"));
      const result = await showTyping(5);
      expect(result).toBe(false);
      expect(isTypingActive()).toBe(false);
    });

    it("returns true when newly started", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      const result = await showTyping(5);
      expect(result).toBe(true);
      expect(isTypingActive()).toBe(true);
      cancelTyping();
    });

    it("returns false (extended) when already active", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(10);
      const result = await showTyping(20);
      expect(result).toBe(false);
      cancelTyping();
    });

    it("calls sendChatAction with provided action", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(5, "record_voice");
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
      cancelTyping();
    });

    it("auto-cancels when deadline passes", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(1);
      expect(isTypingActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(isTypingActive()).toBe(false);
    });

    it("does not cancel non-persistent animation on show_typing (ephemeral must not cancel)", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      mocks.isAnimationActive.mockReturnValue(true);
      mocks.isAnimationPersistent.mockReturnValue(false);
      await showTyping(5);
      expect(mocks.cancelAnimation).not.toHaveBeenCalled();
      cancelTyping();
    });

    it("does not cancel persistent animation on show_typing", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      mocks.isAnimationActive.mockReturnValue(true);
      mocks.isAnimationPersistent.mockReturnValue(true);
      await showTyping(5);
      expect(mocks.cancelAnimation).not.toHaveBeenCalled();
      cancelTyping();
    });

    it("does not cancel animation on record_voice action (ephemeral indicator)", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      mocks.isAnimationActive.mockReturnValue(true);
      mocks.isAnimationPersistent.mockReturnValue(false);
      await showTyping(5, "record_voice");
      expect(mocks.cancelAnimation).not.toHaveBeenCalled();
      cancelTyping();
    });

    it("cancels when sendChatAction rejects during interval tick", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(10);
      expect(isTypingActive()).toBe(true);
      // Subsequent sendChatAction calls (interval ticks) will fail
      mocks.sendChatAction.mockRejectedValue(new Error("network error"));
      // Advance past INTERVAL_MS (4000 ms)
      await vi.advanceTimersByTimeAsync(4100);
      expect(isTypingActive()).toBe(false);
    });
  });

  describe("typingGeneration", () => {
    it("increases each time showTyping starts a new indicator", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      const gen0 = typingGeneration();
      await showTyping(5);
      const gen1 = typingGeneration();
      cancelTyping();
      await showTyping(5);
      const gen2 = typingGeneration();
      cancelTyping();
      expect(gen1).toBeGreaterThan(gen0);
      expect(gen2).toBeGreaterThan(gen1);
    });

    it("also increments when extending an existing indicator", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(5);
      const genBefore = typingGeneration();
      await showTyping(10); // extend
      expect(typingGeneration()).toBeGreaterThan(genBefore);
      cancelTyping();
    });
  });

  describe("cancelTypingIfSameGeneration", () => {
    it("returns false and does nothing when generation has changed", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(5);
      const gen = typingGeneration();
      await showTyping(10); // advances generation
      expect(cancelTypingIfSameGeneration(gen)).toBe(false);
      expect(isTypingActive()).toBe(true);
      cancelTyping();
    });

    it("cancels and returns true when generation matches", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      await showTyping(5);
      const gen = typingGeneration();
      expect(cancelTypingIfSameGeneration(gen)).toBe(true);
      expect(isTypingActive()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Suppression tests (bugs 2, 3, 4)
  // -------------------------------------------------------------------------
  describe("typing suppression", () => {
    beforeEach(() => {
      resetTypingSuppressionForTest();
    });

    afterEach(() => {
      resetTypingSuppressionForTest();
    });

    // Bug 2: suppression is intentionally total — all TypingAction types blocked
    it("suppresses all action types (not just 'typing') while a chat is suppressed", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      pauseTypingEmission(123);

      // showTyping with non-default action types must not fire sendChatAction
      await showTyping(5, "upload_photo");
      expect(mocks.sendChatAction).not.toHaveBeenCalled();
      cancelTyping();

      vi.clearAllMocks();
      await showTyping(5, "record_voice");
      expect(mocks.sendChatAction).not.toHaveBeenCalled();
      cancelTyping();

      vi.clearAllMocks();
      await showTyping(5, "upload_document");
      expect(mocks.sendChatAction).not.toHaveBeenCalled();
      cancelTyping();
    });

    // Bug 3: initial sendChatAction must not fire when suppression is active
    it("does not fire even one sendChatAction on initial showTyping when chat is suppressed", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      pauseTypingEmission(123);

      const result = await showTyping(10);
      // showTyping should still return true (started — timer is running for when
      // suppression is lifted), but sendChatAction must NOT have been called.
      expect(result).toBe(true);
      expect(mocks.sendChatAction).not.toHaveBeenCalled();

      // Advance 4 s — interval tick must also be suppressed
      await vi.advanceTimersByTimeAsync(4100);
      expect(mocks.sendChatAction).not.toHaveBeenCalled();

      cancelTyping();
    });

    // Bug 3: interval ticks resume firing after suppression is lifted — priorAction path
    it("resumeTypingEmission restores priorAction captured before suppression", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      // Start a record_voice indicator BEFORE pausing so priorAction is captured.
      await showTyping(30, "record_voice");
      vi.clearAllMocks();

      // Now pause — priorAction is "record_voice" (captured from active state).
      pauseTypingEmission(123);
      expect(mocks.sendChatAction).not.toHaveBeenCalled();

      // Resume — should restore the priorAction ("record_voice"), not fall back to state.action.
      resumeTypingEmission(123);
      expect(mocks.sendChatAction).toHaveBeenCalledTimes(1);
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
      vi.clearAllMocks();

      // Advance 4 s — interval tick should now fire normally.
      await vi.advanceTimersByTimeAsync(4100);
      expect(mocks.sendChatAction).toHaveBeenCalledTimes(1);
      cancelTyping();
    });

    // Bug 3: interval ticks resume firing after suppression — state.action fallback path
    it("resumeTypingEmission falls back to state.action when no prior action captured", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      // Pause BEFORE showTyping — priorAction is undefined (nothing active yet).
      pauseTypingEmission(123);
      // showTyping while suppressed sets state.action = "typing" but does NOT call sendChatAction.
      await showTyping(30);
      expect(mocks.sendChatAction).not.toHaveBeenCalled();

      // Resume — priorAction is undefined, so state.action ("typing") is used as fallback.
      resumeTypingEmission(123);
      expect(mocks.sendChatAction).toHaveBeenCalledTimes(1);
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "typing");
      vi.clearAllMocks();

      // Advance 4 s — interval tick should now fire normally.
      await vi.advanceTimersByTimeAsync(4100);
      expect(mocks.sendChatAction).toHaveBeenCalledTimes(1);
      cancelTyping();
    });

    // Bug 4: resumeTypingEmission restores the prior suppressed action, not hardcoded "typing"
    it("resumeTypingEmission reasserts the original action type (record_voice), not 'typing'", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);

      // Start a record_voice indicator first so it is recorded as the active action
      await showTyping(30, "record_voice");
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
      vi.clearAllMocks();

      // Now suppress the chat — should record the active action as record_voice
      pauseTypingEmission(123);
      expect(suppressedChatActionForTest(123)).toBe("record_voice");

      // Resume — should reassert record_voice not "typing"
      resumeTypingEmission(123);
      expect(mocks.sendChatAction).toHaveBeenCalledOnce();
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "record_voice");

      cancelTyping();
    });

    // Bug 4: resumeTypingEmission with no prior action tracked falls back gracefully
    it("resumeTypingEmission uses 'typing' as fallback when no prior action was tracked", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      // Suppress without any active typing session
      pauseTypingEmission(123);
      expect(suppressedChatActionForTest(123)).toBeUndefined();

      // Start typing (will be suppressed — no initial call)
      await showTyping(30);
      vi.clearAllMocks();

      // Resume — state.action is "typing", priorAction is undefined
      resumeTypingEmission(123);
      expect(mocks.sendChatAction).toHaveBeenCalledWith(123, "typing");
      cancelTyping();
    });

    // Bug 2: verify suppression is total — documents intentional behavior
    it("suppression blocks all action types while active (intentional total suppression)", async () => {
      mocks.sendChatAction.mockResolvedValue(undefined);
      pauseTypingEmission(123);
      expect(isChatSuppressedForTest(123)).toBe(true);

      // None of these should fire
      for (const action of ["typing", "record_voice", "upload_photo", "upload_document", "upload_video"] as const) {
        vi.clearAllMocks();
        await showTyping(5, action);
        expect(mocks.sendChatAction).not.toHaveBeenCalled();
        cancelTyping();
      }
    });
  });
});
