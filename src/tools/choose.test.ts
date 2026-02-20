import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getUpdates: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: () => 0,
    advanceOffset: vi.fn(),
    resolveChat: () => "42",
    pollUntil: async (matcher: any, _timeout: number) => {
      const updates = await mocks.getUpdates();
      const result = matcher(updates);
      const missed = result !== undefined
        ? updates.filter((u: any) => matcher([u]) === undefined)
        : [...updates];
      return { match: result, missed };
    },
  };
});

import { register } from "./choose.js";

const SENT_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

const makeCallbackUpdate = (data: string) => ({
  update_id: 1,
  callback_query: {
    id: "cq1",
    data,
    from: { id: 1, first_name: "Alice", username: "alice" },
    message: { message_id: 7, chat: { id: 42 } },
  },
});

describe("choose tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const OPTIONS = [
    { label: "Option A", value: "opt_a" },
    { label: "Option B", value: "opt_b" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.editMessageText.mockResolvedValue(true);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("choose");
  });

  it("returns chosen label and value", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([makeCallbackUpdate("opt_a")]);
    const result = await call({ question: "Pick one", options: OPTIONS });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.value).toBe("opt_a");
    expect(data.label).toBe("Option A");
  });

  it("answers the callback_query automatically", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([makeCallbackUpdate("opt_b")]);
    await call({ question: "Pick", options: OPTIONS });
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1");
  });

  it("edits message to replace buttons with chosen option", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([makeCallbackUpdate("opt_a")]);
    await call({ question: "Pick one", options: OPTIONS });
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      "42",
      7,
      expect.stringContaining("Option A"),
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        reply_markup: { inline_keyboard: [] },
      }),
    );
  });

  it("does NOT edit message on timeout (keeps buttons active)", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([]);
    await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    // Buttons stay active — no editMessageText call
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("returns timed_out when no button is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([]);
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters callback_queries from different messages", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    // Callback from a different message_id (999 ≠ 7)
    const foreignUpdate = {
      update_id: 2,
      callback_query: {
        id: "cq2",
        data: "opt_a",
        from: { id: 1 },
        message: { message_id: 999, chat: { id: 42 } },
      },
    };
    mocks.getUpdates.mockResolvedValue([foreignUpdate]);
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("validates question text", async () => {
    const result = await call({ question: "", options: OPTIONS });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
  });

  it("rejects callback_data over 64 bytes", async () => {
    const badOptions = [
      { label: "A", value: "a".repeat(65) },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: badOptions });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("rejects label over 20 chars for 2-column layout", async () => {
    const longOptions = [
      { label: "A very long label text", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 2 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_TOO_LONG");
  });

  it("allows label up to 35 chars for single-column layout", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([]);
    const longOptions = [
      { label: "A somewhat longer label text ok", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 1, timeout_seconds: 1 });
    expect(isError(result)).toBe(false);
  });

  it("builds keyboard rows with correct column count", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.getUpdates.mockResolvedValue([]);
    const threeOptions = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
      { label: "C", value: "c" },
    ];
    await call({ question: "Pick", options: threeOptions, columns: 3, timeout_seconds: 1 });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    // All 3 options in a single row when columns=3
    expect(opts.reply_markup.inline_keyboard[0]).toHaveLength(3);
  });

  it("returns skipped with text when user types instead of pressing button", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    // User sends a text message instead of pressing a button
    mocks.getUpdates.mockResolvedValue([
      {
        update_id: 5,
        message: { message_id: 20, text: "hello", chat: { id: 42 } },
      },
    ]);
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    const data = parseResult(result) as any;
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("hello");
    expect(data.text_message_id).toBe(20);
    // Buttons should be removed and message edited to show "Skipped"
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      "42",
      7,
      expect.stringContaining("Skipped"),
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        reply_markup: { inline_keyboard: [] },
      }),
    );
  });

  it("callback_query takes priority over text in same batch", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    // Both a text message and a callback_query arrive in the same batch
    mocks.getUpdates.mockResolvedValue([
      {
        update_id: 5,
        message: { message_id: 20, text: "oops wrong chat", chat: { id: 42 } },
      },
      makeCallbackUpdate("opt_a"),
    ]);
    const result = await call({ question: "Pick", options: OPTIONS });
    const data = parseResult(result) as any;
    // Callback wins — choice is returned, no skipped
    expect(data.timed_out).toBe(false);
    expect(data.value).toBe("opt_a");
    expect(data.label).toBe("Option A");
    expect(data.skipped).toBeUndefined();
  });
});
