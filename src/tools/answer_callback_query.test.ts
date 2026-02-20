import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ answerCallbackQuery: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./answer_callback_query.js";

describe("answer_callback_query tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("answer_callback_query");
  });

  it("returns ok: true on success", async () => {
    mocks.answerCallbackQuery.mockResolvedValue(true);
    const result = await call({ callback_query_id: "cq123" });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).ok).toBe(true);
  });

  it("passes optional text and show_alert", async () => {
    mocks.answerCallbackQuery.mockResolvedValue(true);
    await call({ callback_query_id: "cq1", text: "Done!", show_alert: true });
    const [, opts] = mocks.answerCallbackQuery.mock.calls[0];
    expect(opts.text).toBe("Done!");
    expect(opts.show_alert).toBe(true);
  });

  it("surfaces API errors", async () => {
    const { GrammyError } = await import("grammy");
    mocks.answerCallbackQuery.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: query is too old" }, "answerCallbackQuery", {})
    );
    const result = await call({ callback_query_id: "old" });
    expect(isError(result)).toBe(true);
  });
});
