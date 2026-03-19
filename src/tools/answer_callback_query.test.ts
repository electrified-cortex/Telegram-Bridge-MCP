import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false), answerCallbackQuery: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks };
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
    const result = await call({ callback_query_id: "cq123", identity: [1, 123456]});
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).ok).toBe(true);
  });

  it("passes optional text and show_alert", async () => {
    mocks.answerCallbackQuery.mockResolvedValue(true);
    await call({ callback_query_id: "cq1", text: "Done!", show_alert: true, identity: [1, 123456]});
    const [, opts] = mocks.answerCallbackQuery.mock.calls[0];
    expect(opts.text).toBe("Done!");
    expect(opts.show_alert).toBe(true);
  });

  it("surfaces API errors", async () => {
    const { GrammyError } = await import("grammy");
    mocks.answerCallbackQuery.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: query is too old" }, "answerCallbackQuery", {})
    );
    const result = await call({ callback_query_id: "old", identity: [1, 123456]});
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"callback_query_id":"q1"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"callback_query_id":"q1","identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"callback_query_id":"q1","identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
