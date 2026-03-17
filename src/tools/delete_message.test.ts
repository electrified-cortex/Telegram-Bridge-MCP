import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 42),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

import { register } from "./delete_message.js";

describe("delete_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("delete_message");
  });

  it("returns ok: true on success", async () => {
    mocks.deleteMessage.mockResolvedValue(true);
    const result = await call({ message_id: 5 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).ok).toBe(true);
  });

  it("passes chat_id and message_id to API", async () => {
    mocks.deleteMessage.mockResolvedValue(true);
    await call({ message_id: 99 });
    expect(mocks.deleteMessage).toHaveBeenCalledWith(42, 99);
  });

  it("returns MESSAGE_CANT_BE_DELETED for old or unauthorised messages", async () => {
    const { GrammyError } = await import("grammy");
    mocks.deleteMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" }, "deleteMessage", {})
    );
    const result = await call({ message_id: 1 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_CANT_BE_DELETED");
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 1 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });
});
