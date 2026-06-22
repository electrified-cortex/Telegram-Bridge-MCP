import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  pinChatMessage: vi.fn(),
  unpinChatMessage: vi.fn(),
  dlog: vi.fn(),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      pinChatMessage: mocks.pinChatMessage,
      unpinChatMessage: mocks.unpinChatMessage,
    }),
  };
});

vi.mock("./debug-log.js", () => ({
  dlog: mocks.dlog,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  tryPinQuestion,
  untrackAndUnpinQuestion,
  cleanupSessionQuestionPins,
  resetQuestionPinsForTest,
  getQuestionPinsForSession,
} from "./question-pin-state.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("question-pin-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQuestionPinsForTest();
  });

  // ─── tryPinQuestion ────────────────────────────────────────────────────────

  describe("tryPinQuestion", () => {
    it("calls pinChatMessage with disable_notification:true", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      const result = await tryPinQuestion(-100123, 42, 1);
      expect(result).toBe(true);
      expect(mocks.pinChatMessage).toHaveBeenCalledWith(-100123, 42, { disable_notification: true });
    });

    it("returns true and tracks the pin on success", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      const ok = await tryPinQuestion(-100123, 42, 1);
      expect(ok).toBe(true);
      const pins = getQuestionPinsForSession(1);
      expect(pins).toHaveLength(1);
      expect(pins[0]).toEqual({ chatId: -100123, messageId: 42 });
    });

    it("returns false and does NOT track on API failure (silent)", async () => {
      mocks.pinChatMessage.mockRejectedValue(new Error("FORBIDDEN"));
      const ok = await tryPinQuestion(-100123, 42, 1);
      expect(ok).toBe(false);
      const pins = getQuestionPinsForSession(1);
      expect(pins).toHaveLength(0);
    });

    it("logs at debug level on failure", async () => {
      mocks.pinChatMessage.mockRejectedValue(new Error("no rights"));
      await tryPinQuestion(-100123, 42, 1);
      expect(mocks.dlog).toHaveBeenCalledWith("tool", expect.stringContaining("pin failed"));
    });

    it("tracks multiple pins for the same session", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      await tryPinQuestion(-100123, 20, 1);
      const pins = getQuestionPinsForSession(1);
      expect(pins).toHaveLength(2);
    });

    it("tracks pins for multiple sessions independently", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      await tryPinQuestion(-100456, 20, 2);
      expect(getQuestionPinsForSession(1)).toHaveLength(1);
      expect(getQuestionPinsForSession(2)).toHaveLength(1);
    });
  });

  // ─── untrackAndUnpinQuestion ────────────────────────────────────────────────

  describe("untrackAndUnpinQuestion", () => {
    it("calls unpinChatMessage", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      mocks.unpinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 42, 1);
      await untrackAndUnpinQuestion(-100123, 42);
      expect(mocks.unpinChatMessage).toHaveBeenCalledWith(-100123, 42);
    });

    it("removes the pin from tracking before the API call", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      mocks.unpinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 42, 1);
      await untrackAndUnpinQuestion(-100123, 42);
      expect(getQuestionPinsForSession(1)).toHaveLength(0);
    });

    it("swallows unpin API errors silently", async () => {
      mocks.unpinChatMessage.mockRejectedValue(new Error("not pinned"));
      await expect(untrackAndUnpinQuestion(-100123, 42)).resolves.toBeUndefined();
    });

    it("logs at debug level on unpin failure", async () => {
      mocks.unpinChatMessage.mockRejectedValue(new Error("not pinned"));
      await untrackAndUnpinQuestion(-100123, 42);
      expect(mocks.dlog).toHaveBeenCalledWith("tool", expect.stringContaining("unpin failed"));
    });
  });

  // ─── cleanupSessionQuestionPins ────────────────────────────────────────────

  describe("cleanupSessionQuestionPins", () => {
    it("unpins all tracked messages for the given session", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      mocks.unpinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      await tryPinQuestion(-100123, 20, 1);
      cleanupSessionQuestionPins(1);
      // Give the fire-and-forget calls time to run
      await Promise.resolve();
      expect(mocks.unpinChatMessage).toHaveBeenCalledTimes(2);
      expect(getQuestionPinsForSession(1)).toHaveLength(0);
    });

    it("does not touch pins belonging to other sessions", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      mocks.unpinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      await tryPinQuestion(-100456, 20, 2);
      cleanupSessionQuestionPins(1);
      await Promise.resolve();
      expect(mocks.unpinChatMessage).toHaveBeenCalledTimes(1);
      expect(mocks.unpinChatMessage).toHaveBeenCalledWith(-100123, 10);
      expect(getQuestionPinsForSession(2)).toHaveLength(1);
    });

    it("is a no-op when the session has no tracked pins", () => {
      cleanupSessionQuestionPins(99);
      expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
    });

    it("removes from tracking synchronously (before fire-and-forget resolves)", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      mocks.unpinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      cleanupSessionQuestionPins(1);
      // Immediately after call — tracking should already be cleared
      expect(getQuestionPinsForSession(1)).toHaveLength(0);
    });
  });

  // ─── resetQuestionPinsForTest ───────────────────────────────────────────────

  describe("resetQuestionPinsForTest", () => {
    it("clears all tracked pins", async () => {
      mocks.pinChatMessage.mockResolvedValue(true);
      await tryPinQuestion(-100123, 10, 1);
      await tryPinQuestion(-100456, 20, 2);
      resetQuestionPinsForTest();
      expect(getQuestionPinsForSession(1)).toHaveLength(0);
      expect(getQuestionPinsForSession(2)).toHaveLength(0);
    });
  });
});
