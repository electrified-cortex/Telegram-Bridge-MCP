import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  editMessageText: vi.fn(),
  sendMessage: vi.fn(),
  unpinChatMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 1),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./update_progress.js";
import { resetCompletionTrackingForTest } from "./update_progress.js";

describe("update_progress tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.unpinChatMessage.mockResolvedValue(true);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    resetCompletionTrackingForTest();
    const server = createMockServer();
    register(server);
    call = server.getHandler("update_progress");
  });

  it("edits message in-place and returns updated: true", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, percent: 75, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.updated).toBe(true);
    expect(data.message_id).toBe(10);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
  });

  it("renders updated bar with bold title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, title: "Building", token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<b>Building</b>");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders bar-only when no title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50, token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).not.toContain("<b>");
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("renders subtext when provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50, subtext: "half done", token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<i>half done</i>");
  });

  it("handles boolean result from editMessageText (Telegram unchanged)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.updated).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("auto-unpins when percent reaches 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1, 10);
  });

  it("sends completion reply when percent reaches 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    mocks.sendMessage.mockResolvedValue({ message_id: 11 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      1,
      "✅ Complete",
      expect.objectContaining({ reply_parameters: { message_id: 10 }, _skipHeader: true }),
    );
  });

  it("does not send duplicate completion reply on repeated 100% updates", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send completion reply when percent is less than 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 99, token: 1123456 });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when percent is less than 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 99, token: 1123456 });
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"message_id":1,"percent":50});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"message_id":1,"percent":50,"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"message_id":1,"percent":50,"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
