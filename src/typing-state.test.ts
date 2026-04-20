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

import { showTyping, cancelTyping, isTypingActive, typingGeneration, cancelTypingIfSameGeneration } from "./typing-state.js";

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
});
