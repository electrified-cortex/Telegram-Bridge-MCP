import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ pinChatMessage: vi.fn(), unpinChatMessage: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => 1 };
});

import { register } from "./pin_message.js";

describe("pin_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("pin_message");
  });

  it("returns ok: true on success", async () => {
    mocks.pinChatMessage.mockResolvedValue(true);
    const result = await call({ message_id: 5 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).ok).toBe(true);
  });

  it("passes disable_notification option", async () => {
    mocks.pinChatMessage.mockResolvedValue(true);
    await call({ message_id: 5, disable_notification: true });
    const [, , opts] = mocks.pinChatMessage.mock.calls[0];
    expect(opts.disable_notification).toBe(true);
  });

  it("returns NOT_ENOUGH_RIGHTS when bot lacks admin", async () => {
    const { GrammyError } = await import("grammy");
    mocks.pinChatMessage.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: not enough rights" }, "pinChatMessage", {})
    );
    const result = await call({ message_id: 5 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("NOT_ENOUGH_RIGHTS");
  });

  it("returns MISSING_MESSAGE_ID when pinning without a message_id", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_MESSAGE_ID");
    expect(mocks.pinChatMessage).not.toHaveBeenCalled();
  });

  it("unpins with message_id when provided", async () => {
    mocks.unpinChatMessage.mockResolvedValue(true);
    const result = await call({ message_id: 5, unpin: true });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as { unpinned: boolean }).unpinned).toBe(true);
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1, 5);
  });

  it("unpins most recent when unpin: true and no message_id", async () => {
    mocks.unpinChatMessage.mockResolvedValue(true);
    const result = await call({ unpin: true });
    expect(isError(result)).toBe(false);
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1);
  });
});
