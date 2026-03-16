import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "./telegram.js";

const mocks = vi.hoisted(() => ({
  sendChatAction: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 123),
  fireTempReactionRestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./temp-reaction.js", () => ({
  fireTempReactionRestore: mocks.fireTempReactionRestore,
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("./telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

import { showTyping, cancelTyping, isTypingActive } from "./typing-state.js";

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
  });
});
