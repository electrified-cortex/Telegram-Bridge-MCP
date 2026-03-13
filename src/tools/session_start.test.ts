import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult } from "./test-utils.js";
import type { ButtonResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  pendingCount: vi.fn(),
  dequeue: vi.fn(),
  pollButtonPress: vi.fn(),
  ackAndEditSelection: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: () => 42,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
  pendingCount: (...args: unknown[]) => mocks.pendingCount(...args),
  dequeue: (...args: unknown[]) => mocks.dequeue(...args),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonPress: (...args: unknown[]) => mocks.pollButtonPress(...args),
    ackAndEditSelection: (...args: unknown[]) =>
      mocks.ackAndEditSelection(...args),
  };
});

import { register } from "./session_start.js";

const INTRO_MSG = { message_id: 100, chat: { id: 42 }, date: 0 };
const CONFIRM_MSG = { message_id: 101, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return {
    kind: "button",
    callback_query_id: "cq1",
    data,
    message_id: 101,
  };
}

describe("session_start tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(INTRO_MSG);
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("session_start");
  });

  it("sends intro message and returns fresh when no pending", async () => {
    mocks.pendingCount.mockReturnValue(0);

    const result = parseResult(await call({}));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    // Check intro text was sent
    const sentCall = mocks.sendMessage.mock.calls[0] as unknown[];
    expect(sentCall[0]).toBe(42); // chatId
    expect(result).toEqual({
      action: "fresh",
      pending: 0,
      intro_message_id: 100,
    });
  });

  it("uses custom intro text", async () => {
    mocks.pendingCount.mockReturnValue(0);

    await call({ intro: "Welcome back!" });

    const sentCall = mocks.sendMessage.mock.calls[0] as unknown[];
    // The raw text should contain our custom intro
    const opts = sentCall[2] as Record<string, unknown>;
    expect(opts._rawText).toBe("Welcome back!");
  });

  it("asks user and drains on Start Fresh", async () => {
    mocks.pendingCount.mockReturnValue(3);
    // After intro is sent, second sendMessage is the confirmation
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    // Simulate draining 3 messages
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce({ id: 3 })
      .mockReturnValueOnce(undefined);

    const result = parseResult(await call({}));

    expect(result).toEqual({
      action: "fresh",
      discarded: 3,
      intro_message_id: 100,
    });
    // Confirmation should have been ack'd
    expect(mocks.ackAndEditSelection).toHaveBeenCalledTimes(1);
  });

  it("asks user and returns resume with pending count", async () => {
    mocks.pendingCount.mockReturnValue(5);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_resume"),
    );

    const result = parseResult(await call({}));

    expect(result).toEqual({
      action: "resume",
      pending: 5,
      intro_message_id: 100,
    });
    expect(mocks.ackAndEditSelection).toHaveBeenCalledTimes(1);
  });

  it("sends confirmation with Start Fresh as first button", async () => {
    mocks.pendingCount.mockReturnValue(2);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    mocks.dequeue
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ id: 2 })
      .mockReturnValueOnce(undefined);

    await call({});

    // Second sendMessage call is the confirmation
    const confirmCall = mocks.sendMessage.mock.calls[1] as unknown[];
    const opts = confirmCall[2] as Record<string, unknown>;
    const markup = opts.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const buttons = markup.inline_keyboard[0];
    // "Start Fresh" should be the first (default) button
    expect(buttons[0].text).toContain("Start Fresh");
    expect(buttons[0].callback_data).toBe("session_fresh");
    expect(buttons[1].text).toContain("Resume");
    expect(buttons[1].callback_data).toBe("session_resume");
  });

  it("confirmation text includes pending count", async () => {
    mocks.pendingCount.mockReturnValue(7);
    mocks.sendMessage
      .mockResolvedValueOnce(INTRO_MSG)
      .mockResolvedValueOnce(CONFIRM_MSG);
    mocks.pollButtonPress.mockResolvedValue(
      makeButtonResult("session_fresh"),
    );
    // drain 7
    for (let i = 0; i < 7; i++) {
      mocks.dequeue.mockReturnValueOnce({ id: i + 1 });
    }
    mocks.dequeue.mockReturnValueOnce(undefined);

    await call({});

    const confirmCall = mocks.sendMessage.mock.calls[1] as unknown[];
    const rawText = (confirmCall[2] as Record<string, unknown>)
      ._rawText as string;
    expect(rawText).toContain("7");
    expect(rawText).toContain("message");
  });
});
