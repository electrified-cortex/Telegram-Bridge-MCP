import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  registerCallbackHook: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageReplyMarkup: mocks.editMessageReplyMarkup,
    }),
    resolveChat: () => 42,
  };
});

vi.mock("../topic-state.js", () => ({
  applyTopicToText: mocks.applyTopicToText,
}));

vi.mock("../message-store.js", () => ({
  registerCallbackHook: mocks.registerCallbackHook,
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
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_choice");
  });

  it("sends message with keyboard and returns message_id immediately", async () => {
    const result = await call({ text: "Pick one", options: TWO_OPTIONS });
    expect(isError(result)).toBe(false);
    expect(parseResult(result).message_id).toBe(9);
  });

  it("sends inline keyboard with one row of two buttons by default", async () => {
    await call({ text: "Rate it", options: TWO_OPTIONS });
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
    await call({ text: "Choose", options: TWO_OPTIONS, columns: 1 });
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
    await call({ text: "Confirm?", options });
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
    await call({ text: "Pick", options: TWO_OPTIONS });
    expect(mocks.registerCallbackHook).toHaveBeenCalledWith(9, expect.any(Function));
  });

  it("does NOT block — resolves without waiting for button press", async () => {
    // The tool should resolve without any dequeue/poll happening
    const result = await call({ text: "Quick?", options: TWO_OPTIONS });
    expect(isError(result)).toBe(false);
    // answerCallbackQuery and editMessageReplyMarkup are NOT called at send time
    expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("passes reply_to_message_id via reply_parameters", async () => {
    await call({ text: "Reply", options: TWO_OPTIONS, reply_to_message_id: 5 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({ reply_parameters: { message_id: 5 } }),
    );
  });

  it("passes disable_notification option", async () => {
    await call({ text: "Quiet", options: TWO_OPTIONS, disable_notification: true });
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
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("rejects if fewer than 2 options are provided (Zod min constraint)", async () => {
    let threw = false;
    try {
      await call({ text: "Pick", options: [{ label: "Only", value: "one" }] });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("returns error when sendMessage API fails", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("network error"));
    const result = await call({ text: "Fail", options: TWO_OPTIONS });
    expect(isError(result)).toBe(true);
  });
});
