import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ forwardMessage: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./forward_message.js";

describe("forward_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("forward_message");
  });

  it("forwards and returns message_id", async () => {
    mocks.forwardMessage.mockResolvedValue({ message_id: 20, chat: { id: 2 }, date: 0 });
    const result = await call({ chat_id: "2", from_chat_id: "1", message_id: 10 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).message_id).toBe(20);
  });

  it("passes args to API in correct order", async () => {
    mocks.forwardMessage.mockResolvedValue({ message_id: 1, chat: { id: 2 }, date: 0 });
    await call({ chat_id: "2", from_chat_id: "1", message_id: 10 });
    expect(mocks.forwardMessage).toHaveBeenCalledWith("2", "1", 10, expect.any(Object));
  });

  it("surfaces API errors", async () => {
    const { GrammyError } = await import("grammy");
    mocks.forwardMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "forwardMessage", {})
    );
    const result = await call({ chat_id: "bad", from_chat_id: "1", message_id: 1 });
    expect(isError(result)).toBe(true);
  });
});
