import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  editMessageText: vi.fn(),
  registerCallbackHook: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
  resolveChat: vi.fn((): number | TelegramError => 42),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
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

vi.mock("../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

vi.mock("../message-store.js", () => ({
  registerCallbackHook: mocks.registerCallbackHook,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./send_choice.js";

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

  it("hook invokes answerCallbackQuery and collapses message with selected label on button press", async () => {
    await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    const [hookedMessageId, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, (evt: { content: { qid?: string; data?: string } }) => void];
    expect(hookedMessageId).toBe(9);

    mocks.answerCallbackQuery.mockResolvedValue(undefined);
    mocks.editMessageText.mockResolvedValue(undefined);

    // Simulate a button press callback event — user picked "like"
    hookFn({ content: { qid: "ack123", data: "like" } });

    // Flush async microtasks
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("ack123");
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42, 9,
      expect.stringContaining("Like it"),
      expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );
  });

  it("hook skips answerCallbackQuery when qid is absent", async () => {
    await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, (evt: { content: { qid?: string; data?: string } }) => void];

    mocks.editMessageText.mockResolvedValue(undefined);
    hookFn({ content: { data: "dislike" } });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocks.editMessageText).toHaveBeenCalled();
  });

  it("hook uses raw data as label when data does not match any option", async () => {
    await call({ text: "Pick", options: TWO_OPTIONS, token: 1123456});
    const [, hookFn] = mocks.registerCallbackHook.mock.calls[0] as [number, (evt: { content: { qid?: string; data?: string } }) => void];

    mocks.editMessageText.mockResolvedValue(undefined);
    hookFn({ content: { data: "ghost" } });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42, 9,
      expect.stringContaining("ghost"),
      expect.any(Object),
    );
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

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
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
