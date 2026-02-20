import { describe, it, expect } from "vitest";
import { GrammyError } from "grammy";
import {
  validateText,
  validateCaption,
  validateCallbackData,
  toResult,
  toError,
  LIMITS,
} from "./telegram.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeGrammyError(error_code: number, description: string): GrammyError {
  return new GrammyError(
    description,
    { ok: false, error_code, description },
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
  ];

  it.each(cases)("%s → %s", (_label, httpCode, description, expectedCode) => {
    const result = toError(makeGrammyError(httpCode, description));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe(expectedCode);
  });

  it("classifies 429 as RATE_LIMITED with retry_after", () => {
    const err = makeGrammyError(429, "Too Many Requests: retry after 5");
    (err as any).parameters = { retry_after: 5 };
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
