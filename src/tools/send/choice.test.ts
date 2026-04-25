import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "../../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  editMessageText: vi.fn(),
  registerCallbackHook: vi.fn(),
  registerPersistentCallbackHook: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
  resolveChat: vi.fn((): number | TelegramError => 42),
  validateText: vi.fn((): TelegramError | null => null),
}));

type HookFn = (evt: { content: { qid?: string; data?: string } }) => void;

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageReplyMarkup: mocks.editMessageReplyMarkup,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

vi.mock("../../message-store.js", () => ({
  registerCallbackHook: mocks.registerCallbackHook,
  registerPersistentCallbackHook: mocks.registerPersistentCallbackHook,
}));

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./choice.js";

const BASE_MSG = { message_id: 9, chat: { id: 42 }, date: 0 };
const TWO_OPTIONS = [
  { label: "Like it", value: "like" },
  { label: "Dislike it", value: "dislike" },
];

describe("send_choice tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_choice");
  });

  it("sends message with keyboard and returns message_id immediately", async () => {
    const result = await call({ text: "Pick one", options: TWO_OPTIONS, token: 1123456});
    expect(isError(result)).toBe(false);
    expect(parseResult(result).message_id).toBe(9);
  });

  it("sends inline keyboard with one row of two buttons by default", async () => {
    await call({ text: "Rate it", options: TWO_OPTIONS, token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[
            { text: "Like it", callback_data: "like" },
            { text: "Dislike it", callback_data: "dislike" },
          ]],
        },
      }),
    );
  });

  it("respects columns=1 layout", async () => {
    await call({ text: "Choose", options: TWO_OPTIONS, columns: 1, token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [{ text: "Like it", callback_data: "like" }],
            [{ text: "Dislike it", callback_data: "dislike" }],
          ],
        },
      }),
    );
  });

  it("includes button styles when provided", async () => {
    const options = [
      { label: "Yes", value: "yes", style: "success" as const },
      { label: "No", value: "no", style: "danger" as const },
    ];
    await call({ text: "Confirm?", options, token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[
            { text: "Yes", callback_data: "yes", style: "success" },
            { text: "No", callback_data: "no", style: "danger" },
          ]],
        },
      }),
    );
  });

  it("registers a one-shot callback hook after sending", async () => {
    await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    expect(mocks.registerCallbackHook).toHaveBeenCalledWith(9, expect.any(Function), expect.any(Number));
  });

  it("does NOT block — resolves without waiting for button press", async () => {
    // The tool should resolve without any dequeue/poll happening
    const result = await call({ text: "Quick?", options: TWO_OPTIONS, token: 1123456});
    expect(isError(result)).toBe(false);
    // answerCallbackQuery and editMessageReplyMarkup are NOT called at send time
    expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // One-shot highlight-then-collapse (default mode)
  // ---------------------------------------------------------------------------

  describe("one-shot collapse (default, persistent omitted)", () => {
    beforeEach(() => {
      mocks.answerCallbackQuery.mockResolvedValue(undefined);
      mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
      mocks.editMessageText.mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stage 1: acks callback and calls editMessageReplyMarkup with highlighted rows", async () => {
      vi.useFakeTimers();
      await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456 });
      const [hookedMessageId, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];
      expect(hookedMessageId).toBe(9);

      hookFn({ content: { qid: "ack123", data: "like" } });
      // Flush microtasks — enough for stage 1 (no timer needed)
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("ack123");
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(
        42, 9,
        expect.objectContaining({
          reply_markup: {
            inline_keyboard: [[
              // Clicked "like" gets primary (no original style → fallback)
              { text: "Like it", callback_data: "like", style: "primary" },
              // Non-clicked "dislike" style stripped (plain)
              { text: "Dislike it", callback_data: "dislike" },
            ]],
          },
        }),
      );
      // editMessageText not yet called (timer hasn't fired)
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it("stage 2: after ~150 ms timer fires, collapses keyboard and appends selection suffix", async () => {
      vi.useFakeTimers();
      await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456 });
      const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "ack123", data: "like" } });
      await Promise.resolve();
      await Promise.resolve();

      // Stage 1 done — advance timer past collapse delay
      await vi.advanceTimersByTimeAsync(200);

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 9,
        expect.stringContaining("Like it"),
        expect.objectContaining({
          reply_markup: { inline_keyboard: [] },
        }),
      );
    });

    it("stage 2 keyboard is explicitly empty (not omitted)", async () => {
      vi.useFakeTimers();
      await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456 });
      const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "ack123", data: "like" } });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);

      const callArgs = mocks.editMessageText.mock.calls[0] as [number, number, string, Record<string, unknown>];
      const markup = callArgs[3].reply_markup as { inline_keyboard: unknown[][] };
      // reply_markup must be explicitly present with empty inline_keyboard
      // (omitting it would leave the keyboard intact in Telegram)
      expect(markup).toBeDefined();
      expect(markup.inline_keyboard).toEqual([]);
    });

    it("non-clicked buttons have style stripped in stage-1 highlight", async () => {
      vi.useFakeTimers();
      const styledOptions = [
        { label: "Yes", value: "yes", style: "success" as const },
        { label: "No", value: "no", style: "danger" as const },
      ];
      await call({ text: "Confirm?", options: styledOptions, token: 1123456 });
      const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "q1", data: "yes" } });
      await Promise.resolve();
      await Promise.resolve();

      const rmArgs = mocks.editMessageReplyMarkup.mock.calls[0] as [number, number, Record<string, unknown>];
      const keyboard = (rmArgs[2].reply_markup as { inline_keyboard: { text: string; callback_data: string; style?: string }[][] }).inline_keyboard;
      // Clicked "yes" keeps original style (success)
      expect(keyboard[0][0]).toMatchObject({ style: "success" });
      // Non-clicked "no" has style stripped (plain)
      expect(keyboard[0][1]).not.toHaveProperty("style");
    });

    it("hook skips answerCallbackQuery when qid is absent", async () => {
      vi.useFakeTimers();
      await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456 });
      const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { data: "dislike" } });
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalled();
    });

    it("hook uses raw data as label when data does not match any option", async () => {
      vi.useFakeTimers();
      await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456 });
      const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { data: "ghost" } });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 9,
        expect.stringContaining("ghost"),
        expect.any(Object),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Persistent / multi-tap mode (persistent: true)
  // ---------------------------------------------------------------------------

  describe("persistent mode (persistent: true)", () => {
    beforeEach(() => {
      mocks.answerCallbackQuery.mockResolvedValue(undefined);
      mocks.editMessageReplyMarkup.mockResolvedValue(undefined);
      mocks.editMessageText.mockResolvedValue(undefined);
    });

    it("uses registerPersistentCallbackHook (not one-shot) in persistent mode", async () => {
      await call({ text: "Pick", options: TWO_OPTIONS, persistent: true, token: 1123456 });
      expect(mocks.registerPersistentCallbackHook).toHaveBeenCalledWith(9, expect.any(Function), expect.any(Number));
      expect(mocks.registerCallbackHook).not.toHaveBeenCalled();
    });

    it("keeps keyboard visible after press — calls editMessageText with highlighted rows (not empty)", async () => {
      await call({ text: "Pick", options: TWO_OPTIONS, persistent: true, token: 1123456 });
      const [, hookFn] = mocks.registerPersistentCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "ack123", data: "like" } });
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("ack123");
      // editMessageText called with non-empty keyboard (persistent highlight)
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        42, 9,
        expect.stringContaining("Like it"),
        expect.objectContaining({
          reply_markup: {
            inline_keyboard: [[
              { text: "Like it", callback_data: "like", style: "primary" },
              { text: "Dislike it", callback_data: "dislike" },
            ]],
          },
        }),
      );
      // editMessageReplyMarkup not called (persistent path skips stage-1 markup edit)
      expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
    });

    it("does not call editMessageReplyMarkup in persistent mode (single editMessageText call)", async () => {
      await call({ text: "Pick", options: TWO_OPTIONS, persistent: true, token: 1123456 });
      const [, hookFn] = mocks.registerPersistentCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "ack456", data: "dislike" } });
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("each tap invokes the registered hook fn independently (closure is stateless)", async () => {
      // Verifies that the hook closure itself is reusable: calling it multiple
      // times (as registerPersistentCallbackHook guarantees at the infra layer)
      // results in a separate ackAndEditSelection call for each press.
      await call({ text: "Pick", options: TWO_OPTIONS, persistent: true, token: 1123456 });
      const [, hookFn] = mocks.registerPersistentCallbackHook.mock.calls[0] as [number, HookFn];

      hookFn({ content: { qid: "q1", data: "like" } });
      await new Promise<void>((r) => setTimeout(r, 0));
      hookFn({ content: { qid: "q2", data: "dislike" } });
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mocks.editMessageText).toHaveBeenCalledTimes(2);
    });
  });

  it("passes reply_to via reply_parameters", async () => {
    await call({ text: "Reply", options: TWO_OPTIONS, reply_to: 5, token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ reply_parameters: { message_id: 5 } }),
    );
  });

  it("passes disable_notification option", async () => {
    await call({ text: "Quiet", options: TWO_OPTIONS, disable_notification: true, token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ disable_notification: true }),
    );
  });

  it("returns error for callback_data that is too long", async () => {
    const longValue = "x".repeat(65);
    const result = await call({
      text: "Pick",
      options: [
        { label: "A", value: longValue },
        { label: "B", value: "ok" },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("rejects if fewer than 2 options are provided (Zod min constraint)", async () => {
    let threw = false;
    try {
      await call({ token: 1123456, text: "Pick", options: [{ label: "Only", value: "one" }] });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("returns error when sendMessage API fails", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("network error"));
    const result = await call({ text: "Fail", options: TWO_OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("returns BUTTON_LABEL_EXCEEDS_LIMIT for label > hard limit", async () => {
    const longLabel = "x".repeat(65); // BUTTON_TEXT limit is 64
    const result = await call({
      text: "Pick",
      options: [
        { label: longLabel, value: "a" },
        { label: "Short", value: "b" },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_EXCEEDS_LIMIT");
  });

  it("returns BUTTON_LABEL_TOO_LONG for label > display max", async () => {
    const mediumLabel = "x".repeat(21); // BUTTON_DISPLAY_MULTI_COL is 20
    const result = await call({
      text: "Pick",
      columns: 2,
      options: [
        { label: mediumLabel, value: "a" },
        { label: "Short", value: "b" },
      ],
      token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_TOO_LONG");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"text":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong suffix", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"text":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}],"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"text":"x","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}],"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
