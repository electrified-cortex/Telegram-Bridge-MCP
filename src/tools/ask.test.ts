import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getUpdates: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: () => 0,
    advanceOffset: vi.fn(),
  };
});

import { register } from "./ask.js";

const BASE_MSG = { message_id: 10, chat: { id: 42 }, date: 1000 };

describe("ask tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("ask");
  });

  it("sends question and returns reply text", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks.getUpdates.mockResolvedValue([
      { update_id: 1, message: { ...BASE_MSG, text: "sure", from: null, chat: { id: 42 } } },
    ]);
    const result = await call({ chat_id: "42", question: "Continue?" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("sure");
  });

  it("returns timed_out when no matching update arrives", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    mocks.getUpdates.mockResolvedValue([]);
    const result = await call({ chat_id: "42", question: "Continue?" });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(true);
  });

  it("filters updates by chat_id", async () => {
    mocks.sendMessage.mockResolvedValue(BASE_MSG);
    // Update from a different chat — should be ignored
    mocks.getUpdates.mockResolvedValue([
      { update_id: 1, message: { ...BASE_MSG, text: "hi", chat: { id: 999 } } },
    ]);
    const result = await call({ chat_id: "42", question: "Hello?" });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("validates question text before sending", async () => {
    const result = await call({ chat_id: "42", question: "" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
