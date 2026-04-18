import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  answerCallbackQuery: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  resolveChat: vi.fn((): number => 12345),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageReplyMarkup: mocks.editMessageReplyMarkup,
    }),
    resolveChat: mocks.resolveChat,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./answer_callback_query.js";

describe("answer_callback_query tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("answer_callback_query");
  });

  it("returns ok: true on success", async () => {
    mocks.answerCallbackQuery.mockResolvedValue(true);
    const result = await call({ callback_query_id: "cq123", token: 1_123_456});
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).ok).toBe(true);
  });

  it("passes optional text and show_alert", async () => {
    mocks.answerCallbackQuery.mockResolvedValue(true);
    await call({ callback_query_id: "cq1", text: "Done!", show_alert: true, token: 1_123_456});
    const [, opts] = mocks.answerCallbackQuery.mock.calls[0];
    expect(opts.text).toBe("Done!");
    expect(opts.show_alert).toBe(true);
  });

  it("surfaces API errors", async () => {
    const { GrammyError } = await import("grammy");
    mocks.answerCallbackQuery.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: query is too old" }, "answerCallbackQuery", {})
    );
    const result = await call({ callback_query_id: "old", token: 1_123_456});
    expect(isError(result)).toBe(true);
  });

  describe("remove_keyboard", () => {
    it("calls editMessageReplyMarkup with empty keyboard when remove_keyboard: true and message_id provided", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageReplyMarkup.mockResolvedValue(true);
      const result = await call({ callback_query_id: "cq1", token: 1_123_456, remove_keyboard: true, message_id: 42 });
      expect(isError(result)).toBe(false);
      expect((parseResult(result)).ok).toBe(true);
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalledOnce();
      expect(mocks.editMessageReplyMarkup).toHaveBeenCalledWith(12345, 42, { reply_markup: { inline_keyboard: [] } });
    });

    it("returns ok: true and writes to stderr when editMessageReplyMarkup throws", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageReplyMarkup.mockRejectedValue(new Error("edit failed"));
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await call({ callback_query_id: "cq2", token: 1_123_456, remove_keyboard: true, message_id: 99 });
      expect(isError(result)).toBe(false);
      expect((parseResult(result)).ok).toBe(true);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[warn] remove_keyboard failed:"));
      stderrSpy.mockRestore();
    });

    it("returns MISSING_MESSAGE_ID error when remove_keyboard: true without message_id", async () => {
      const result = await call({ callback_query_id: "cq3", token: 1_123_456, remove_keyboard: true });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("MISSING_MESSAGE_ID");
      expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it("does not call editMessageReplyMarkup when remove_keyboard is false or omitted", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      await call({ callback_query_id: "cq4", token: 1_123_456 });
      expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
      mocks.editMessageReplyMarkup.mockClear();
      await call({ callback_query_id: "cq5", token: 1_123_456, remove_keyboard: false, message_id: 10 });
      expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
    });

    it("writes stderr warning and skips editMessageReplyMarkup when resolveChat returns non-number", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.resolveChat.mockReturnValueOnce({ code: "NO_CHAT", message: "no active chat" } as unknown as number);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await call({ callback_query_id: "cq6", token: 1_123_456, remove_keyboard: true, message_id: 42 });
      expect(isError(result)).toBe(false);
      expect((parseResult(result)).ok).toBe(true);
      expect(mocks.editMessageReplyMarkup).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[warn] remove_keyboard skipped: could not resolve chat"));
      stderrSpy.mockRestore();
    });
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({"callback_query_id":"q1"});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({"callback_query_id":"q1","token": 1_099_999});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({"callback_query_id":"q1","token": 1_099_999})); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });
  });

});
