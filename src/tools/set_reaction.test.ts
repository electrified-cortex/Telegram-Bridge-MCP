import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import { GrammyError } from "grammy";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  setMessageReaction: vi.fn(),
  setTempReaction: vi.fn(),
  resetPremiumCacheForTest: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: () => 42 };
});

vi.mock("../temp-reaction.js", () => ({
  setTempReaction: mocks.setTempReaction,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register, resetPremiumCacheForTest } from "./set_reaction.js";

describe("set_reaction tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetPremiumCacheForTest();
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_reaction");
    mocks.setMessageReaction.mockResolvedValue(true);
    mocks.setTempReaction.mockResolvedValue(true);
  });

  // ── Permanent reaction ────────────────────────────────────────────────────

  it("sets an emoji reaction and returns ok", async () => {
    const result = await call({ message_id: 100, emoji: "👍", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.message_id).toBe(100);
    expect(data.emoji).toBe("👍");
    expect(data.temporary).toBe(false);
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      42, 100, [{ type: "emoji", emoji: "👍" }], { is_big: undefined },
    );
  });

  it("removes reaction when emoji is omitted (empty reaction array)", async () => {
    const result = await call({ message_id: 55, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.emoji).toBeNull();
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(42, 55, [], { is_big: undefined });
  });

  it("forwards is_big flag to API", async () => {
    await call({ message_id: 10, emoji: "🎉", is_big: true, token: 1123456});
    const [, , , opts] = mocks.setMessageReaction.mock.calls[0];
    expect(opts.is_big).toBe(true);
  });

  it("resolves aliases to canonical emoji", async () => {
    const result = await call({ message_id: 100, emoji: "rocket", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.emoji).toBe("🚀");
  });

  it("rejects an emoji not in the allowed list (returns error)", async () => {
    const result = await call({ message_id: 1, emoji: "💀", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary string that is not an emoji or alias (returns error)", async () => {
    const result = await call({ message_id: 1, emoji: "notanemoji", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
  });

  it("maps API errors to TelegramError", async () => {
    mocks.setMessageReaction.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "setMessageReaction", {}),
    );
    const result = await call({ message_id: 1, emoji: "👍", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });

  // ── Temporary reaction ────────────────────────────────────────────────────

  it("routes to setTempReaction when temporary=true (no restore_emoji)", async () => {
    const result = await call({ message_id: 77, emoji: "👀", temporary: true, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(data.emoji).toBe("👀");
    expect(data.restore_emoji).toBeNull();
    expect(mocks.setTempReaction).toHaveBeenCalledWith(77, "👀", undefined, undefined);
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("routes to setTempReaction when restore_emoji is provided", async () => {
    const result = await call({ message_id: 100, emoji: "reading", restore_emoji: "salute", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(data.emoji).toBe("👀");
    expect(data.restore_emoji).toBe("🫡");
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", "🫡", undefined);
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("routes to setTempReaction when timeout_seconds is provided", async () => {
    const result = await call({ message_id: 55, emoji: "👀", timeout_seconds: 300, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(data.timeout_seconds).toBe(300);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(55, "👀", undefined, 300);
  });

  it("temporary: restore_emoji=undefined means remove-on-restore (no restore_emoji arg)", async () => {
    const result = await call({ message_id: 10, emoji: "👀", timeout_seconds: 60, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.restore_emoji).toBeNull();
    expect(mocks.setTempReaction).toHaveBeenCalledWith(10, "👀", undefined, 60);
  });

  it("temporary: returns error for invalid restore_emoji", async () => {
    const result = await call({ message_id: 1, emoji: "👀", restore_emoji: "notanemoji", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
  });

  it("temporary: requires emoji when restore_emoji is set", async () => {
    const result = await call({ message_id: 1, restore_emoji: "salute", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
  });

  it("temporary: returns error when setTempReaction fails", async () => {
    mocks.setTempReaction.mockResolvedValue(false);
    const result = await call({ message_id: 1, emoji: "👀", restore_emoji: "🫡", token: 1123456});
    expect(isError(result)).toBe(true);
  });

  // ── Fallback array logic ─────────────────────────────────────────────────────────

  it("falls back to second candidate when preferred gets REACTION_INVALID", async () => {
    // 'done' resolves to ['✅', '👍'] — ✅ fails, 👍 should succeed
    mocks.setMessageReaction
      .mockRejectedValueOnce(
        new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: REACTION_INVALID" }, "setMessageReaction", {}),
      )
      .mockResolvedValueOnce(true);
    const result = await call({ message_id: 10, emoji: "done", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.emoji).toBe("👍");
    expect(data.fallback_used).toBe(true);
    expect(data.requested).toBe("✅");
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(2);
  });

  it("succeeds with preferred emoji when no fallback needed (done alias)", async () => {
    const result = await call({ message_id: 11, emoji: "done", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.emoji).toBe("✅");
    expect(data.fallback_used).toBeUndefined();
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(1);
  });

  it("propagates non-REACTION_INVALID error even when fallback exists", async () => {
    // done → ['✅', '👍'] — ✅ throws CHAT_NOT_FOUND (not REACTION_INVALID), error should propagate
    mocks.setMessageReaction.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "setMessageReaction", {}),
    );
    const result = await call({ message_id: 1, emoji: "done", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
    // Only tried first candidate before propagating
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(1);
  });

  it("premium cache: skips premium emoji after fallback fires", async () => {
    // First call: ✅ fails → falls back to 👍 → caches non-premium
    mocks.setMessageReaction
      .mockRejectedValueOnce(
        new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: REACTION_INVALID" }, "setMessageReaction", {}),
      )
      .mockResolvedValue(true);
    await call({ message_id: 10, emoji: "done", token: 1123456 });

    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.setMessageReaction.mockResolvedValue(true);

    // Second call: should skip ✅ and go straight to 👍
    const result = await call({ message_id: 11, emoji: "done", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.emoji).toBe("👍");
    expect(data.fallback_used).toBe(true);
    // Only one attempt (skipped ✅)
    const [, , reaction] = mocks.setMessageReaction.mock.calls[0];
    expect((reaction as { emoji: string }[])[0].emoji).toBe("👍");
  });

  it("premium cache: sets premium=true after premium emoji succeeds", async () => {
    // ✅ succeeds → cache should be set to premium
    mocks.setMessageReaction.mockResolvedValue(true);
    await call({ message_id: 10, emoji: "done", token: 1123456 });

    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.setMessageReaction.mockResolvedValue(true);

    // Second call: still tries ✅ first (premium confirmed)
    const result = await call({ message_id: 11, emoji: "done", token: 1123456 });
    const data = parseResult(result);
    expect(data.emoji).toBe("✅");
    expect(data.fallback_used).toBeUndefined();
    const [, , reaction2] = mocks.setMessageReaction.mock.calls[0];
    expect((reaction2 as { emoji: string }[])[0].emoji).toBe("✅");
  });
});

describe("set_reaction tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_reaction");
    mocks.setMessageReaction.mockResolvedValue(true);
  });

  it("sets an emoji reaction and returns ok", async () => {
    const result = await call({ message_id: 100, emoji: "👍", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.message_id).toBe(100);
    expect(data.emoji).toBe("👍");
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      42,
      100,
      [{ type: "emoji", emoji: "👍" }],
      { is_big: undefined },
    );
  });

  it("removes reaction when emoji is omitted (empty reaction array)", async () => {
    const result = await call({ message_id: 55, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.emoji).toBeNull();
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(42, 55, [], { is_big: undefined });
  });

  it("forwards is_big flag to API", async () => {
    await call({ message_id: 10, emoji: "🎉", is_big: true, token: 1123456});
    const [, , , opts] = mocks.setMessageReaction.mock.calls[0];
    expect(opts.is_big).toBe(true);
  });

  it("resolves aliases to canonical emoji", async () => {
    const result = await call({ message_id: 100, emoji: "rocket", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.emoji).toBe("🚀");
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      42,
      100,
      [{ type: "emoji", emoji: "🚀" }],
      { is_big: undefined },
    );
  });

  it("rejects an emoji not in the allowed list (returns error)", async () => {
    // 💀 is not in ALLOWED_EMOJI and not an alias
    const result = await call({ message_id: 1, emoji: "💀", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary string that is not an emoji or alias (returns error)", async () => {
    const result = await call({ message_id: 1, emoji: "notanemoji", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
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
    const result = await call({ message_id: 1, emoji: "👍", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"message_id":1});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"message_id":1,"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
