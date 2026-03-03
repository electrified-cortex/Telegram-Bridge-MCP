import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import { GrammyError } from "grammy";

const mocks = vi.hoisted(() => ({ setMessageReaction: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "42" };
});

import { register } from "./set_reaction.js";

describe("set_reaction tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("set_reaction");
    mocks.setMessageReaction.mockResolvedValue(true);
  });

  it("sets an emoji reaction and returns ok", async () => {
    const result = await call({ message_id: 100, emoji: "👍" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.ok).toBe(true);
    expect(data.message_id).toBe(100);
    expect(data.emoji).toBe("👍");
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      "42",
      100,
      [{ type: "emoji", emoji: "👍" }],
      { is_big: undefined },
    );
  });

  it("removes reaction when emoji is omitted (empty reaction array)", async () => {
    const result = await call({ message_id: 55 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.ok).toBe(true);
    expect(data.emoji).toBeNull();
    expect(mocks.setMessageReaction).toHaveBeenCalledWith("42", 55, [], { is_big: undefined });
  });

  it("forwards is_big flag to API", async () => {
    await call({ message_id: 10, emoji: "🎉", is_big: true });
    const [, , , opts] = mocks.setMessageReaction.mock.calls[0];
    expect(opts.is_big).toBe(true);
  });

  it("resolves aliases to canonical emoji", async () => {
    const result = await call({ message_id: 100, emoji: "rocket" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.ok).toBe(true);
    expect(data.emoji).toBe("🚀");
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      "42",
      100,
      [{ type: "emoji", emoji: "🚀" }],
      { is_big: undefined },
    );
  });

  it("rejects an emoji not in the allowed list (returns error)", async () => {
    // 💀 is not in ALLOWED_EMOJI and not an alias
    const result = await call({ message_id: 1, emoji: "💀" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_DATA_INVALID");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary string that is not an emoji or alias (returns error)", async () => {
    const result = await call({ message_id: 1, emoji: "notanemoji" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_DATA_INVALID");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("maps API errors to TelegramError", async () => {
    mocks.setMessageReaction.mockRejectedValue(
      new GrammyError(
        "e",
        { ok: false, error_code: 400, description: "Bad Request: chat not found" },
        "setMessageReaction",
        {},
      ),
    );
    const result = await call({ message_id: 1, emoji: "👍" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });
});
