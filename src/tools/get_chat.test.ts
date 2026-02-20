import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getChat: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./get_chat.js";

describe("get_chat tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_chat");
  });

  it("returns chat info", async () => {
    const chat = { id: -100, type: "group", title: "Dev Chat" };
    mocks.getChat.mockResolvedValue(chat);
    const result = await call({ chat_id: "-100" });
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual(chat);
  });

  it("passes chat_id to API", async () => {
    mocks.getChat.mockResolvedValue({ id: 1, type: "private" });
    await call({ chat_id: "@username" });
    expect(mocks.getChat).toHaveBeenCalledWith("@username");
  });

  it("returns error when chat not found", async () => {
    const { GrammyError } = await import("grammy");
    mocks.getChat.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "getChat", {})
    );
    const result = await call({ chat_id: "bad" });
    expect(isError(result)).toBe(true);
  });
});
