import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  unpinChatMessage: vi.fn((): Promise<void> => Promise.resolve()),
  resolveChat: vi.fn((): number | { code: string; message: string } => 42),
}));

vi.mock("./telegram.js", () => ({
  resolveChat: () => mocks.resolveChat(),
  getApi: () => ({
    getChat: mocks.getChat,
    unpinChatMessage: mocks.unpinChatMessage,
  }),
}));

// ── Import after mocks ─────────────────────────────────────

import { cleanupStalePins } from "./startup-token-cleanup.js";

// ── Helpers ───────────────────────────────────────────────

function makeBotPin(messageId: number, text: string) {
  return {
    message_id: messageId,
    from: { id: 999, is_bot: true, first_name: "Bot" },
    text,
  };
}

function makeOperatorPin(messageId: number, text: string) {
  return {
    message_id: messageId,
    from: { id: 111, is_bot: false, first_name: "Operator" },
    text,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe("cleanupStalePins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveChat.mockReturnValue(42);
  });

  it("does nothing when resolveChat returns a non-number", async () => {
    mocks.resolveChat.mockReturnValue({ code: "CHAT_NOT_FOUND", message: "not configured" });
    await cleanupStalePins();
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pinned message", async () => {
    mocks.getChat.mockResolvedValue({ id: 42, type: "supergroup" });
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("unpins a single stale bot session announcement", async () => {
    mocks.getChat
      .mockResolvedValueOnce({ id: 42, pinned_message: makeBotPin(100, "🟦 🤖 Overseer\nSession 1 — 🟢 Online") })
      .mockResolvedValueOnce({ id: 42 }); // no more pins after cleanup
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(42, 100);
  });

  it("unpins multiple stale bot announcements in a loop", async () => {
    mocks.getChat
      .mockResolvedValueOnce({ id: 42, pinned_message: makeBotPin(200, "🟩 🤖 Worker\nSession 2 — 🟢 Online") })
      .mockResolvedValueOnce({ id: 42, pinned_message: makeBotPin(100, "🟦 🤖 Overseer\nSession 1 — 🟢 Online") })
      .mockResolvedValueOnce({ id: 42 }); // done
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.unpinChatMessage).toHaveBeenNthCalledWith(1, 42, 200);
    expect(mocks.unpinChatMessage).toHaveBeenNthCalledWith(2, 42, 100);
  });

  it("does NOT unpin a message sent by a non-bot (operator pinned message)", async () => {
    mocks.getChat.mockResolvedValue({ id: 42, pinned_message: makeOperatorPin(50, "Important team note") });
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("stops at the first non-bot pinned message even if stale announcements were cleaned before it", async () => {
    mocks.getChat
      .mockResolvedValueOnce({ id: 42, pinned_message: makeBotPin(300, "Session 3 — 🟢 Online") })
      .mockResolvedValueOnce({ id: 42, pinned_message: makeOperatorPin(50, "Project kick-off notes") });
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(42, 300);
  });

  it("does NOT unpin a bot message that does not match the announcement pattern", async () => {
    mocks.getChat.mockResolvedValue({
      id: 42,
      pinned_message: makeBotPin(77, "📦 *Telegram Bridge MCP*\n\n🟢 Online\nSession record: off"),
    });
    await cleanupStalePins();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("swallows getChat errors gracefully", async () => {
    mocks.getChat.mockRejectedValue(new Error("network error"));
    await expect(cleanupStalePins()).resolves.toBeUndefined();
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("swallows unpinChatMessage errors and stops", async () => {
    mocks.getChat.mockResolvedValue({ id: 42, pinned_message: makeBotPin(100, "Session 1 — 🟢 Online") });
    mocks.unpinChatMessage.mockRejectedValue(new Error("not enough rights"));
    await expect(cleanupStalePins()).resolves.toBeUndefined();
  });
});
