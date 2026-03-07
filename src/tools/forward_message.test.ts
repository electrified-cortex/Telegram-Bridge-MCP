import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ forwardMessage: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "2" };
});

import { register } from "./forward_message.js";
import { resetSecurityConfig } from "../telegram.js";

describe("forward_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_USER_ID = "12345";
    process.env.ALLOWED_CHAT_ID = "2";
    resetSecurityConfig();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("forward_message");
  });

  afterEach(() => {
    process.env.ALLOWED_USER_ID = envBefore.ALLOWED_USER_ID;
    process.env.ALLOWED_CHAT_ID = envBefore.ALLOWED_CHAT_ID;
    resetSecurityConfig();
  });

  it("forwards and returns message_id", async () => {
    mocks.forwardMessage.mockResolvedValue({ message_id: 20, chat: { id: 2 }, date: 0 });
    const result = await call({ from_chat_id: "2", message_id: 10 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).message_id).toBe(20);
  });

  it("passes args to API in correct order", async () => {
    mocks.forwardMessage.mockResolvedValue({ message_id: 1, chat: { id: 2 }, date: 0 });
    await call({ from_chat_id: "2", message_id: 10 });
    expect(mocks.forwardMessage).toHaveBeenCalledWith("2", "2", 10, expect.any(Object));
  });

  it("rejects forwarding from a different chat", async () => {
    const result = await call({ from_chat_id: "999", message_id: 10 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result) as any;
    expect(data.code).toBe("UNAUTHORIZED_CHAT");
  });

  it("surfaces API errors", async () => {
    const { GrammyError } = await import("grammy");
    mocks.forwardMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "forwardMessage", {})
    );
    const result = await call({ from_chat_id: "2", message_id: 1 });
    expect(isError(result)).toBe(true);
  });
});
