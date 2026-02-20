import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./get_me.js";

describe("get_me tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_me");
  });

  it("returns bot info", async () => {
    const bot = { id: 1, is_bot: true, first_name: "Bot", username: "test_bot" };
    mocks.getMe.mockResolvedValue(bot);
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual(bot);
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.getMe.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 401, description: "Unauthorized" }, "getMe", {})
    );
    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
