import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setMessageReaction: vi.fn(),
  trySetMessageReaction: vi.fn(),
  getBotReaction: vi.fn<(messageId: number) => string | null>().mockReturnValue(null),
}));

vi.mock("./message-store.js", () => ({
  getBotReaction: mocks.getBotReaction,
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("./telegram.js")>();
  return {
    ...actual,
    resolveChat: () => 42,
    getApi: () => ({ setMessageReaction: mocks.setMessageReaction }),
    trySetMessageReaction: mocks.trySetMessageReaction,
  };
});

import {
  setTempReaction,
  fireTempReactionRestore,
  hasTempReaction,
  resetTempReactionForTest,
} from "./temp-reaction.js";

describe("temp-reaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetTempReactionForTest();
    mocks.trySetMessageReaction.mockResolvedValue(true);
    mocks.setMessageReaction.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTempReactionForTest();
  });

  it("sets a reaction and records the slot", async () => {
    const ok = await setTempReaction(100, "👀");
    expect(ok).toBe(true);
    expect(hasTempReaction()).toBe(true);
    expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(42, 100, "👀");
  });

  it("restore fires restore_emoji on next outbound", async () => {
    await setTempReaction(100, "👀", "🫡" as never);
    await fireTempReactionRestore();
    expect(mocks.trySetMessageReaction).toHaveBeenLastCalledWith(42, 100, "🫡");
    expect(hasTempReaction()).toBe(false);
  });

  it("clears reaction when no restore_emoji and no previous reaction recorded", async () => {
    await setTempReaction(100, "\uD83D\uDC40");
    await fireTempReactionRestore();
    // Initial set + clear (empty array via setMessageReaction)
    expect(mocks.trySetMessageReaction).toHaveBeenCalledTimes(1);
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(42, 100, []);
    expect(hasTempReaction()).toBe(false);
  });

  it("is a no-op when no slot is active", async () => {
    await fireTempReactionRestore();
    expect(mocks.trySetMessageReaction).not.toHaveBeenCalled();
  });

  it("auto-reverts after timeout_seconds", async () => {
    await setTempReaction(100, "👀", "🫡" as never, 30);
    expect(hasTempReaction()).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.trySetMessageReaction).toHaveBeenLastCalledWith(42, 100, "🫡");
    expect(hasTempReaction()).toBe(false);
  });

  it("replacing slot cancels previous without restoring", async () => {
    await setTempReaction(100, "👀", "🫡" as never);
    vi.clearAllMocks();
    await setTempReaction(200, "🤔", "✅" as never);
    // Should NOT have fired the 🫡 restore for the first slot
    expect(mocks.trySetMessageReaction).toHaveBeenCalledTimes(1);
    expect(mocks.trySetMessageReaction).toHaveBeenCalledWith(42, 200, "🤔");
    expect(hasTempReaction()).toBe(true);
  });

  it("auto-restores to previously recorded reaction when restore_emoji is omitted", async () => {
    mocks.getBotReaction.mockReturnValue("🫡");
    await setTempReaction(100, "👀");
    await fireTempReactionRestore();
    expect(mocks.trySetMessageReaction).toHaveBeenLastCalledWith(42, 100, "🫡");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("clears reaction if no previous reaction recorded and no restore_emoji", async () => {
    mocks.getBotReaction.mockReturnValue(null);
    await setTempReaction(100, "\uD83D\uDC40");
    await fireTempReactionRestore();
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(42, 100, []);
    expect(hasTempReaction()).toBe(false);
  });
});
