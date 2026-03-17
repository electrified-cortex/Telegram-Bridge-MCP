import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  getChat: vi.fn(),
  pollButtonPress: vi.fn(),
  ackAndEditSelection: vi.fn(),
  editWithTimedOut: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      getChat: mocks.getChat,
    }),
    resolveChat: () => 99,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonPress: (...args: unknown[]) => mocks.pollButtonPress(...args),
    ackAndEditSelection: (...args: unknown[]) => mocks.ackAndEditSelection(...args),
    editWithTimedOut: (...args: unknown[]) => mocks.editWithTimedOut(...args),
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

import { register } from "./get_chat.js";

describe("get_chat tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue({ message_id: 1 });
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithTimedOut.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_chat");
  });

  it("returns chat info when user approves", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    mocks.getChat.mockResolvedValue({ id: 99, type: "group", title: "Dev Chat" });
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({
      approved: true,
      id: 99, type: "group", title: "Dev Chat",
    });
  });

  it("sends confirmation prompt with Allow/Deny buttons", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    mocks.getChat.mockResolvedValue({ id: 99, type: "private" });
    await call({});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      99,
      expect.any(String),
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Allow", callback_data: "get_chat_yes" },
            { text: "❌ Deny", callback_data: "get_chat_no" },
          ]],
        },
      }),
    );
  });

  it("returns approved:false when user denies", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q2", data: "get_chat_no", message_id: 1,
    });
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({ approved: false, timed_out: false });
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it("returns approved:false timed_out:true on timeout", async () => {
    mocks.pollButtonPress.mockResolvedValue(null);
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({ approved: false, timed_out: true });
    expect(mocks.editWithTimedOut).toHaveBeenCalled();
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it("returns error when getChat API fails", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    const { GrammyError } = await import("grammy");
    mocks.getChat.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "getChat", {}),
    );
    const result = await call({});
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when multiple sessions active and no identity", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when multiple sessions active and identity is valid", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

  it("proceeds when single session active and no identity (backward compat)", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(1);
    let code: string | undefined;
    try { code = errorCode(await call({})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
  });
});

});
