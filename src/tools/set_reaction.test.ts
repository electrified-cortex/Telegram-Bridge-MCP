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
  recordBotReaction: vi.fn(),
  hasBaseReaction: vi.fn(() => false),
  markBaseReaction: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: () => 42 };
});

vi.mock("../temp-reaction.js", () => ({
  setTempReaction: mocks.setTempReaction,
}));

vi.mock("../message-store.js", () => ({
  recordBotReaction: mocks.recordBotReaction,
  getBotReaction: vi.fn(() => null),
  hasBaseReaction: mocks.hasBaseReaction,
  markBaseReaction: mocks.markBaseReaction,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register, resetPremiumCacheForTest, handleSetReactionPreset } from "./set_reaction.js";

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
    // Suppress base 👌 reaction in these pre-existing tests
    mocks.hasBaseReaction.mockReturnValue(true);
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

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({"message_id":1});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
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

describe("set_reaction tool — array reactions form", () => {
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
    // Suppress base 👌 reaction in these pre-existing tests
    mocks.hasBaseReaction.mockReturnValue(true);
  });

  it("2-layer: permanent base + temp overlay — one setTempReaction call, correct restoreEmoji", async () => {
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "👍", priority: -1 },
        { emoji: "👀", priority: 0 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.message_id).toBe(100);
    expect(data.visible).toBe("👀");
    expect(data.restore_emoji).toBe("👍");
    // recordBotReaction called with base emoji
    expect(mocks.recordBotReaction).toHaveBeenCalledWith(100, "👍");
    // setTempReaction called with top emoji and base as restoreEmoji
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", "👍", undefined);
    // setMessageReaction NOT called
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("single-item priority -1 (permanent only): setMessageReaction called directly", async () => {
    const result = await call({
      message_id: 200,
      reactions: [{ emoji: "👍", priority: -1 }],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.visible).toBe("👍");
    expect(data.restore_emoji).toBeNull();
    expect(mocks.setMessageReaction).toHaveBeenCalledWith(
      42, 200, [{ type: "emoji", emoji: "👍" }], {},
    );
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });

  it("single-item priority 0, temporary true: behaves like single-emoji temp call", async () => {
    const result = await call({
      message_id: 300,
      reactions: [{ emoji: "👀", priority: 0, temporary: true }],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.visible).toBe("👀");
    expect(mocks.setTempReaction).toHaveBeenCalledWith(300, "👀", undefined, undefined);
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
  });

  it("invalid emoji in array: returns error, no API calls", async () => {
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "👍", priority: -1 },
        { emoji: "💀", priority: 0 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });

  it("two temp items: returns REACTION_MULTI_TEMP_UNSUPPORTED", async () => {
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "👀", priority: 0 },
        { emoji: "🤔", priority: 1 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_MULTI_TEMP_UNSUPPORTED");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });

  it("alias resolution in array: 'reading' → '👀'", async () => {
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "salute", priority: -1 },
        { emoji: "reading", priority: 0 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.visible).toBe("👀");
    expect(data.restore_emoji).toBe("🫡");
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", "🫡", undefined);
  });

  it("reactions and single emoji both provided: reactions takes precedence", async () => {
    const result = await call({
      message_id: 100,
      emoji: "👍",
      reactions: [
        { emoji: "🤔", priority: -1 },
        { emoji: "👀", priority: 0 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Should use reactions path, visible = top emoji
    expect(data.visible).toBe("👀");
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", "🤔", undefined);
  });

  // ── Fix 1: recordBotReaction not called when setTempReaction fails ─────────

  it("mixed path: setTempReaction fails → error returned AND recordBotReaction NOT called", async () => {
    mocks.setTempReaction.mockResolvedValue(false);
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "👍", priority: -1 },
        { emoji: "👀", priority: 0 },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(mocks.recordBotReaction).not.toHaveBeenCalled();
  });

  // ── Fix 2: temp item is always topItem, even if permanent has higher priority ──

  it("permanent item has higher priority than temp item → temp item is correctly selected as topItem", async () => {
    // priority 10 (permanent) > priority 0 (temp); topItem must be the temp one
    const result = await call({
      message_id: 100,
      reactions: [
        { emoji: "👀", priority: 0, temporary: true },
        { emoji: "👍", priority: 10, temporary: false },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Visible must be the temp item, not the higher-priority permanent item
    expect(data.visible).toBe("👀");
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", "👍", undefined);
  });

  // ── Fix 3: empty reactions array returns REACTION_ARRAY_EMPTY ────────────

  it("empty reactions array → REACTION_ARRAY_EMPTY error", async () => {
    const result = await call({
      message_id: 100,
      reactions: [],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_ARRAY_EMPTY");
    expect(mocks.setMessageReaction).not.toHaveBeenCalled();
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });
});

// ── Default temporality ────────────────────────────────────────────────────

describe("set_reaction — per-emoji default temporality", () => {
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
    mocks.hasBaseReaction.mockReturnValue(false);
  });

  it("🤔 is temporary by default (no explicit temporary param)", async () => {
    const result = await call({ message_id: 10, emoji: "🤔", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(10, "🤔", undefined, undefined);
    // setMessageReaction may be called for the 👌 base reaction (background) — not for 🤔 itself
    const mainReactionCalls = mocks.setMessageReaction.mock.calls.filter(
      (c: unknown[][]) => (c[2] as { emoji?: string }[])[0]?.emoji !== "👌",
    );
    expect(mainReactionCalls).toHaveLength(0);
  });

  it("👀 is temporary by default", async () => {
    const result = await call({ message_id: 10, emoji: "👀", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(10, "👀", undefined, undefined);
  });

  it("⏳ is temporary by default", async () => {
    const result = await call({ message_id: 10, emoji: "⏳", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(10, "⏳", undefined, undefined);
  });

  it("👍 is permanent by default (not in TEMPORARY_BY_DEFAULT)", async () => {
    mocks.hasBaseReaction.mockReturnValue(true); // suppress 👌 to isolate assertion
    const result = await call({ message_id: 10, emoji: "👍", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(false);
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(1);
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });

  it("explicit temporary: false overrides default for 🤔", async () => {
    mocks.hasBaseReaction.mockReturnValue(true); // suppress 👌 to isolate assertion
    const result = await call({ message_id: 10, emoji: "🤔", temporary: false, token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(false);
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(1);
    expect(mocks.setTempReaction).not.toHaveBeenCalled();
  });

  it("explicit temporary: true overrides default for 👍", async () => {
    const result = await call({ message_id: 10, emoji: "👍", temporary: true, token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.temporary).toBe(true);
    expect(mocks.setTempReaction).toHaveBeenCalled();
    // setMessageReaction only called (if at all) for the 👌 base reaction, not for 👍
    const mainCalls = mocks.setMessageReaction.mock.calls.filter(
      (c: unknown[][]) => (c[2] as { emoji?: string }[])[0]?.emoji !== "👌",
    );
    expect(mainCalls).toHaveLength(0);
  });
});

// ── Base 👌 reaction (idempotent) ─────────────────────────────────────────

describe("set_reaction — implicit 👌 base reaction", () => {
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
    mocks.hasBaseReaction.mockReturnValue(false);
  });

  it("markBaseReaction is called after a permanent reaction", async () => {
    await call({ message_id: 50, emoji: "👍", token: 1123456 });
    // Give the background void promise a tick to run
    await new Promise(r => setTimeout(r, 0));
    expect(mocks.markBaseReaction).toHaveBeenCalledWith(42, 50);
  });

  it("markBaseReaction is called after a temporary reaction", async () => {
    await call({ message_id: 51, emoji: "👀", token: 1123456 });
    await new Promise(r => setTimeout(r, 0));
    expect(mocks.markBaseReaction).toHaveBeenCalledWith(42, 51);
  });

  it("👌 is not inserted when hasBaseReaction returns true (idempotent)", async () => {
    mocks.hasBaseReaction.mockReturnValue(true);
    await call({ message_id: 52, emoji: "👍", token: 1123456 });
    await new Promise(r => setTimeout(r, 0));
    expect(mocks.markBaseReaction).not.toHaveBeenCalled();
    // setMessageReaction only called once (for the actual reaction, not for 👌)
    expect(mocks.setMessageReaction).toHaveBeenCalledTimes(1);
  });
});

// ── Reaction presets ───────────────────────────────────────────────────────

describe("handleSetReactionPreset — built-in presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.setMessageReaction.mockResolvedValue(true);
    mocks.setTempReaction.mockResolvedValue(true);
    mocks.hasBaseReaction.mockReturnValue(false);
  });

  it("preset 'processing' fires 2 reactions: 🤔 temp, 👀 temp 10s (no permanent 👍)", async () => {
    const result = await handleSetReactionPreset(1, 42, 100, "processing");
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.preset).toBe("processing");
    expect(data.applied).toEqual(["🤔", "👀"]);
    // No permanent reaction via setMessageReaction
    expect(mocks.setMessageReaction).not.toHaveBeenCalledWith(
      42, 100, [{ type: "emoji", emoji: "👍" }], {},
    );
    // 🤔 and 👀 via setTempReaction
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "🤔", undefined, undefined);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", undefined, 10);
  });

  it("preset 'processing' — 👀 fires with timeout_seconds=10", async () => {
    await handleSetReactionPreset(1, 42, 200, "processing");
    const eyeballCall = mocks.setTempReaction.mock.calls.find(c => c[1] === "👀");
    expect(eyeballCall).toBeDefined();
    expect(eyeballCall![3]).toBe(10);
  });

  it("unknown preset returns an error", async () => {
    const result = await handleSetReactionPreset(1, 42, 300, "nonexistent");
    expect(isError(result)).toBe(true);
  });
});
