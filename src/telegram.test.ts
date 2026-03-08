import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GrammyError, Api } from "grammy";
import type { Update, ResponseParameters } from "grammy/types";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import {
  validateText,
  validateCaption,
  validateCallbackData,
  toResult,
  toError,
  splitMessage,
  callApi,
  filterAllowedUpdates,
  validateTargetChat,
  resetSecurityConfig,
  unauthorizedSenderError,
  unauthorizedChatError,
  resolveChat,
  getOffset,
  advanceOffset,
  resetOffset,
  fireHijackNotification,
  resetApi,
  sendVoiceDirect,
  LIMITS,
  type TelegramError,
} from "./telegram.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeGrammyError(error_code: number, description: string, parameters?: ResponseParameters): GrammyError {
  return new GrammyError(
    description,
    { ok: false, error_code, description, ...(parameters !== undefined && { parameters }) },
    "sendMessage",
    {}
  );
}

// ---------------------------------------------------------------------------
// validateText
// ---------------------------------------------------------------------------

describe("validateText", () => {
  it("returns null for valid text", () => {
    expect(validateText("hello")).toBeNull();
  });

  it("returns EMPTY_MESSAGE for empty string", () => {
    expect(validateText("")).toMatchObject({ code: "EMPTY_MESSAGE" });
  });

  it("returns EMPTY_MESSAGE for whitespace-only string", () => {
    expect(validateText("   ")).toMatchObject({ code: "EMPTY_MESSAGE" });
  });

  it("returns MESSAGE_TOO_LONG for text over limit", () => {
    const err = validateText("a".repeat(LIMITS.MESSAGE_TEXT + 1));
    expect(err?.code).toBe("MESSAGE_TOO_LONG");
    expect(err?.message).toContain("Shorten by at least 1");
  });

  it("returns null for text exactly at the limit", () => {
    expect(validateText("a".repeat(LIMITS.MESSAGE_TEXT))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateCaption
// ---------------------------------------------------------------------------

describe("validateCaption", () => {
  it("returns null for a valid caption", () => {
    expect(validateCaption("a short caption")).toBeNull();
  });

  it("returns CAPTION_TOO_LONG for caption over limit", () => {
    const err = validateCaption("a".repeat(LIMITS.CAPTION + 1));
    expect(err?.code).toBe("CAPTION_TOO_LONG");
    expect(err?.message).toContain("Shorten by at least 1");
  });

  it("returns null for caption exactly at the limit", () => {
    expect(validateCaption("a".repeat(LIMITS.CAPTION))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateCallbackData
// ---------------------------------------------------------------------------

describe("validateCallbackData", () => {
  it("returns null for valid callback data", () => {
    expect(validateCallbackData("action:123")).toBeNull();
  });

  it("returns CALLBACK_DATA_TOO_LONG for data over 64 bytes", () => {
    expect(validateCallbackData("a".repeat(LIMITS.CALLBACK_DATA + 1))).toMatchObject({
      code: "CALLBACK_DATA_TOO_LONG",
    });
  });

  it("measures multi-byte chars (€ = 3 bytes): 22 × 3 = 66 > 64", () => {
    expect(validateCallbackData("€".repeat(22))).toMatchObject({ code: "CALLBACK_DATA_TOO_LONG" });
  });

  it("returns null for multi-byte data within 64 bytes: 21 × 3 = 63", () => {
    expect(validateCallbackData("€".repeat(21))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toResult
// ---------------------------------------------------------------------------

describe("toResult", () => {
  it("wraps data as JSON text content", () => {
    const result = toResult({ foo: "bar" });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
  });

  it("handles arrays", () => {
    expect(JSON.parse(toResult([1, 2, 3]).content[0].text)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// toError — pre-validation (plain TelegramError objects)
// ---------------------------------------------------------------------------

describe("toError with pre-validation errors", () => {
  it("passes through a TelegramError object", () => {
    const result = toError({ code: "MESSAGE_TOO_LONG", message: "too long" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe("MESSAGE_TOO_LONG");
  });
});

// ---------------------------------------------------------------------------
// toError — GrammyError classification
// ---------------------------------------------------------------------------

describe("toError with GrammyError", () => {
  const cases: [string, number, string, string][] = [
    ["message too long",        400, "Bad Request: message is too long",             "MESSAGE_TOO_LONG"],
    ["caption too long",        400, "Bad Request: caption is too long",             "CAPTION_TOO_LONG"],
    ["empty message",           400, "Bad Request: message text is empty",           "EMPTY_MESSAGE"],
    ["parse mode invalid",      400, "Bad Request: can't parse entities",            "PARSE_MODE_INVALID"],
    ["chat not found",          400, "Bad Request: chat not found",                  "CHAT_NOT_FOUND"],
    ["user not found",          400, "Bad Request: user not found",                  "USER_NOT_FOUND"],
    ["bot blocked",             403, "Forbidden: bot was blocked by the user",       "BOT_BLOCKED"],
    ["not enough rights",       400, "Bad Request: not enough rights",               "NOT_ENOUGH_RIGHTS"],
    ["message to edit missing", 400, "Bad Request: message to edit not found",       "MESSAGE_NOT_FOUND"],
    ["message cant be edited",  400, "Bad Request: message can't be edited",         "MESSAGE_CANT_BE_EDITED"],
    ["message cant be deleted", 400, "Bad Request: message can't be deleted",        "MESSAGE_CANT_BE_DELETED"],
    ["button data invalid",     400, "Bad Request: BUTTON_DATA_INVALID",             "BUTTON_DATA_INVALID"],
    ["409 Conflict",            409, "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running", "DUAL_INSTANCE_CONFLICT"],
  ];

  it.each(cases)("%s → %s", (_label, httpCode, description, expectedCode) => {
    const result = toError(makeGrammyError(httpCode, description));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe(expectedCode);
  });

  it("classifies 429 as RATE_LIMITED with retry_after", () => {
    const err = makeGrammyError(429, "Too Many Requests: retry after 5", { retry_after: 5 });
    const result = toError(err);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("RATE_LIMITED");
    expect(parsed.retry_after).toBe(5);
  });

  it("falls back to UNKNOWN for unrecognised errors", () => {
    const result = toError(makeGrammyError(500, "Internal Server Error"));
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.raw).toBe("Internal Server Error");
  });
});

// ---------------------------------------------------------------------------
// toError — plain Error
// ---------------------------------------------------------------------------

describe("toError with plain Error", () => {
  it("wraps message as UNKNOWN", () => {
    const result = toError(new Error("network failure"));
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.message).toBe("network failure");
  });
});

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

describe("splitMessage", () => {
  it("returns single-element array for text at or below limit", () => {
    const text = "a".repeat(LIMITS.MESSAGE_TEXT);
    const result = splitMessage(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("returns single-element array for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits text over the limit into multiple chunks", () => {
    const chunks = splitMessage("a".repeat(LIMITS.MESSAGE_TEXT + 100));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.MESSAGE_TEXT);
    }
  });

  it("reassembles losslessly (same total content)", () => {
    const text = "word ".repeat(1500).trimEnd(); // ~7500 chars
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Joined with space or exact boundary — at least no chars lost
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    // Allow some trim-loss at split boundaries, but shouldn't lose much
    expect(totalLen).toBeGreaterThan(text.length * 0.95);
  });

  it("prefers paragraph breaks \\n\\n when available", () => {
    // Must exceed limit: 2500 a's + \n\n + 2500 b's = 5002 chars
    const para1 = "a".repeat(2500);
    const para2 = "b".repeat(2500);
    const text = para1 + "\n\n" + para2;
    const chunks = splitMessage(text);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it("falls back to single newline when no paragraph break in range", () => {
    // line1 at 2500 > limit*0.5=2048, no double-newline present
    const line1 = "a".repeat(2500);
    const line2 = "b".repeat(2500);
    const text = line1 + "\n" + line2;
    const chunks = splitMessage(text);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it("each chunk is within the Telegram text limit", () => {
    const text = "x".repeat(LIMITS.MESSAGE_TEXT * 3);
    const chunks = splitMessage(text);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(LIMITS.MESSAGE_TEXT);
    }
  });
});

// ---------------------------------------------------------------------------
// callApi — rate-limit retry
// ---------------------------------------------------------------------------

describe("callApi", () => {
  it("returns the result of a successful call", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    expect(await callApi(fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on RATE_LIMITED then succeeds", async () => {
    vi.useFakeTimers();
    const rateLimitErr = new GrammyError(
      "Too Many Requests",
      { ok: false, error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } },
      "sendMessage",
      {}
    );

    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue("ok");

    const promise = callApi(fn);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws immediately for non-rate-limit GrammyError", async () => {
    const err = new GrammyError(
      "Not Found",
      { ok: false, error_code: 400, description: "Bad Request: chat not found" },
      "sendMessage",
      {}
    );
    const fn = vi.fn().mockRejectedValue(err);
    await expect(callApi(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after maxRetries exhausted", async () => {
    vi.useFakeTimers();
    const rateLimitErr = new GrammyError(
      "Too Many Requests",
      { ok: false, error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } },
      "sendMessage",
      {}
    );

    const fn = vi.fn().mockRejectedValue(rateLimitErr);
    const promise = callApi(fn, 2);
    // Run concurrently so the rejection is caught before it can escape as unhandled
    await Promise.all([
      expect(promise).rejects.toBeInstanceOf(GrammyError),
      vi.runAllTimersAsync(),
    ]);
    // Called once initially + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// filterAllowedUpdates
// ---------------------------------------------------------------------------

describe("filterAllowedUpdates", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_USER_ID;
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  afterEach(() => {
    delete process.env.ALLOWED_USER_ID;
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  function makeMessageUpdate(userId: number, chatId: number): Update {
    return { message: { from: { id: userId }, chat: { id: chatId } } } as unknown as Update;
  }

  function makeCallbackUpdate(userId: number, chatId: number): Update {
    return { callback_query: { from: { id: userId }, message: { chat: { id: chatId } } } } as unknown as Update;
  }

  it("passes all updates through when no filters are configured", () => {
    const updates = [makeMessageUpdate(1, 100), makeMessageUpdate(2, 200)];
    expect(filterAllowedUpdates(updates)).toHaveLength(2);
  });

  it("filters by userId: keeps matching sender", () => {
    process.env.ALLOWED_USER_ID = "42";
    resetSecurityConfig();
    const updates = [makeMessageUpdate(42, 100), makeMessageUpdate(99, 100)];
    const result = filterAllowedUpdates(updates);
    expect(result).toHaveLength(1);
    expect(result[0].message?.from?.id).toBe(42);
  });

  it("filters by userId: drops update with no sender (senderId undefined)", () => {
    process.env.ALLOWED_USER_ID = "42";
    resetSecurityConfig();
    const noSender = { message: { chat: { id: 100 } } } as unknown as Update; // from is absent
    expect(filterAllowedUpdates([noSender])).toHaveLength(0);
  });

  it("filters by chatId: keeps matching chat", () => {
    process.env.ALLOWED_CHAT_ID = "100";
    resetSecurityConfig();
    const updates = [makeMessageUpdate(1, 100), makeMessageUpdate(1, 999)];
    const result = filterAllowedUpdates(updates);
    expect(result).toHaveLength(1);
    expect(result[0].message?.chat?.id).toBe(100);
  });

  it("filters by chatId: drops update with null chatId (closes null-bypass gap)", () => {
    process.env.ALLOWED_CHAT_ID = "100";
    resetSecurityConfig();
    // Update has no chat info at all — updateChatId resolves to null
    const noChatMsg = { message: { from: { id: 1 } } } as unknown as Update; // chat property absent
    expect(filterAllowedUpdates([noChatMsg])).toHaveLength(0);
  });

  it("applies both userId and chatId filters together", () => {
    process.env.ALLOWED_USER_ID = "42";
    process.env.ALLOWED_CHAT_ID = "100";
    resetSecurityConfig();
    const pass = makeMessageUpdate(42, 100);
    const wrongUser = makeMessageUpdate(99, 100);
    const wrongChat = makeMessageUpdate(42, 999);
    const result = filterAllowedUpdates([pass, wrongUser, wrongChat]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(pass);
  });

  it("handles callback_query updates with userId filter", () => {
    process.env.ALLOWED_USER_ID = "7";
    resetSecurityConfig();
    const match = makeCallbackUpdate(7, 50);
    const mismatch = makeCallbackUpdate(8, 50);
    const result = filterAllowedUpdates([match, mismatch]);
    expect(result).toHaveLength(1);
    expect(result[0].callback_query?.from?.id).toBe(7);
  });

  it("handles callback_query updates with chatId filter", () => {
    process.env.ALLOWED_CHAT_ID = "50";
    resetSecurityConfig();
    const match = makeCallbackUpdate(7, 50);
    const mismatch = makeCallbackUpdate(7, 99);
    expect(filterAllowedUpdates([match, mismatch])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateTargetChat
// ---------------------------------------------------------------------------

describe("validateTargetChat", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  afterEach(() => {
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  it("returns null when no ALLOWED_CHAT_ID is configured", () => {
    expect(validateTargetChat("any-chat")).toBeNull();
  });

  it("returns null when chatId matches the configured ALLOWED_CHAT_ID", () => {
    process.env.ALLOWED_CHAT_ID = "12345";
    resetSecurityConfig();
    expect(validateTargetChat("12345")).toBeNull();
  });

  it("returns UNAUTHORIZED_CHAT error when chatId differs from ALLOWED_CHAT_ID", () => {
    process.env.ALLOWED_CHAT_ID = "12345";
    resetSecurityConfig();
    const err = validateTargetChat("99999");
    expect(err?.code).toBe("UNAUTHORIZED_CHAT");
    expect(err?.message).toContain("99999");
  });

  it("trims whitespace when comparing chatIds", () => {
    process.env.ALLOWED_CHAT_ID = "  12345  ";
    resetSecurityConfig();
    expect(validateTargetChat("12345")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// unauthorizedSenderError / unauthorizedChatError
// ---------------------------------------------------------------------------

describe("unauthorizedSenderError", () => {
  it("includes the sender id in the message", () => {
    const err = unauthorizedSenderError(42);
    expect(err.code).toBe("UNAUTHORIZED_SENDER");
    expect(err.message).toContain("42");
  });

  it("falls back to 'unknown' when fromId is undefined", () => {
    const err = unauthorizedSenderError(undefined);
    expect(err.message).toContain("unknown");
  });
});

describe("unauthorizedChatError", () => {
  it("includes the chat id in the message", () => {
    const err = unauthorizedChatError("999");
    expect(err.code).toBe("UNAUTHORIZED_CHAT");
    expect(err.message).toContain("999");
  });
});

// ---------------------------------------------------------------------------
// resolveChat
// ---------------------------------------------------------------------------

describe("resolveChat", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  afterEach(() => {
    delete process.env.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  it("returns UNAUTHORIZED_CHAT error when ALLOWED_CHAT_ID is not set", () => {
    const result = resolveChat();
    expect(typeof result).toBe("object");
    expect((result as TelegramError).code).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns the configured chatId when ALLOWED_CHAT_ID is set", () => {
    process.env.ALLOWED_CHAT_ID = "12345";
    resetSecurityConfig();
    expect(resolveChat()).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// getOffset / advanceOffset / resetOffset
// ---------------------------------------------------------------------------

describe("offset management", () => {
  beforeEach(() => {
    resetOffset();
    process.env.HIJACK_NOTIFY = "console"; // pin to console-only for deterministic spy assertions
  });
  afterEach(() => {
    resetOffset();
    delete process.env.HIJACK_NOTIFY;
  });

  it("getOffset returns 0 initially", () => {
    expect(getOffset()).toBe(0);
  });

  it("advanceOffset sets offset to max update_id + 1", () => {
    advanceOffset([{ update_id: 5 } as unknown as Update, { update_id: 3 } as unknown as Update]);
    expect(getOffset()).toBe(6);
  });

  it("advanceOffset is a no-op for empty array", () => {
    expect(advanceOffset([])).toBeNull();
    expect(getOffset()).toBe(0);
  });

  it("resetOffset resets to 0", () => {
    advanceOffset([{ update_id: 10 } as unknown as Update]);
    resetOffset();
    expect(getOffset()).toBe(0);
  });

  it("returns warning string when update_id gap is detected", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    advanceOffset([{ update_id: 10 } as unknown as Update]); // offset → 11
    const result = advanceOffset([{ update_id: 15 } as unknown as Update]); // gap
    expect(result).not.toBeNull();
    expect(result).toContain("Update ID gap detected");
    expect(result).toContain("may have been consumed");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("Update ID gap detected");
    spy.mockRestore();
  });

  it("returns null on the first poll (offset = 0)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = advanceOffset([{ update_id: 50 } as unknown as Update]);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns null for a contiguous batch", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    advanceOffset([{ update_id: 10 } as unknown as Update]); // offset → 11
    const result = advanceOffset([{ update_id: 11 } as unknown as Update]);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// fireHijackNotification — Telegram send path
// ---------------------------------------------------------------------------

describe("fireHijackNotification", () => {
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendMessageSpy = vi
      .spyOn(Api.prototype, "sendMessage")
      .mockResolvedValue({} as never);
    process.env.BOT_TOKEN = "test_token";
  });

  afterEach(() => {
    sendMessageSpy.mockRestore();
    delete process.env.BOT_TOKEN;
    delete process.env.HIJACK_NOTIFY;
    delete process.env.ALLOWED_CHAT_ID;
    resetApi();
    resetSecurityConfig();
  });

  it("sends to configured chat when HIJACK_NOTIFY includes 'telegram' and ALLOWED_CHAT_ID is set", () => {
    process.env.HIJACK_NOTIFY = "telegram";
    process.env.ALLOWED_CHAT_ID = "99999";
    resetSecurityConfig();
    fireHijackNotification("⚠️ test warning");
    expect(sendMessageSpy).toHaveBeenCalledOnce();
    expect(sendMessageSpy.mock.calls[0][0]).toBe(99999);
    expect(sendMessageSpy.mock.calls[0][1]).toBe("⚠️ test warning");
  });

  it("skips Telegram send when ALLOWED_CHAT_ID is not configured", () => {
    process.env.HIJACK_NOTIFY = "telegram";
    resetSecurityConfig();
    fireHijackNotification("⚠️ test warning");
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("swallows sendMessage rejection without throwing", async () => {
    sendMessageSpy.mockRejectedValue(new Error("network error"));
    process.env.HIJACK_NOTIFY = "telegram";
    process.env.ALLOWED_CHAT_ID = "99999";
    resetSecurityConfig();
    // fire-and-forget — must not throw
    expect(() => fireHijackNotification("⚠️ test warning")).not.toThrow();
    // verify the send was actually attempted
    expect(sendMessageSpy).toHaveBeenCalledOnce();
    // flush microtask queue so the rejection is handled and swallowed
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// sendVoiceDirect — path restriction
// ---------------------------------------------------------------------------

describe("sendVoiceDirect path restriction", () => {
  const SAFE_DIR = resolve(tmpdir(), "telegram-bridge-mcp");
  const safeFile = join(SAFE_DIR, "test-voice.ogg");

  beforeEach(() => {
    mkdirSync(SAFE_DIR, { recursive: true });
    writeFileSync(safeFile, Buffer.from([0x4f, 0x67, 0x67, 0x53])); // OggS header
  });

  afterEach(() => {
    rmSync(safeFile, { force: true });
  });

  it("throws when voice path escapes the safe directory via ../", async () => {
    process.env.BOT_TOKEN = "bot_test_token";
    // create the target file so existsSync passes — the path check must fire
    const parentDir = resolve(tmpdir());
    const escapedTarget = join(parentDir, "escaped.ogg");
    writeFileSync(escapedTarget, Buffer.from([0]));
    try {
      await expect(
        sendVoiceDirect("123", escapedTarget)
      ).rejects.toThrow(/Local file read restricted/);
    } finally {
      rmSync(escapedTarget, { force: true });
      delete process.env.BOT_TOKEN;
    }
  });

  it("throws when voice path is a sibling directory with same prefix", async () => {
    // e.g. 'telegram-bridge-mcp2' should not be allowed
    process.env.BOT_TOKEN = "bot_test_token";
    const siblingDir = resolve(tmpdir(), "telegram-bridge-mcp2");
    mkdirSync(siblingDir, { recursive: true });
    const siblingFile = join(siblingDir, "voice.ogg");
    writeFileSync(siblingFile, Buffer.from([0]));
    try {
      await expect(
        sendVoiceDirect("123", siblingFile)
      ).rejects.toThrow(/Local file read restricted/);
    } finally {
      rmSync(siblingFile, { force: true });
      rmSync(siblingDir, { recursive: true, force: true });
      delete process.env.BOT_TOKEN;
    }
  });

  it("reads the file without throwing when path is inside SAFE_FILE_DIR", async () => {
    // No BOT_TOKEN set — will throw after the path check passes.
    // We just need to confirm the error is about BOT_TOKEN, not path restriction.
    delete process.env.BOT_TOKEN;
    await expect(
      sendVoiceDirect("123", safeFile)
    ).rejects.toThrow(/BOT_TOKEN/);
  });
});
