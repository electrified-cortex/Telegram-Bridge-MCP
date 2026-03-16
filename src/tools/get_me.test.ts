import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

vi.mock("module", async (importActual) => {
  const actual = await importActual<typeof import("module")>();
  const mod = Object.assign(Object.create(null) as object, actual);
  return Object.assign(mod, {
    createRequire: () => (path: string) => {
      if (path.endsWith("package.json")) return { version: "0.0.0-test" };
      if (path.endsWith("build-info.json"))
        return { BUILD_COMMIT: "t3stc0mm", BUILD_TIME: "2025-01-01T00:00:00.000Z" };
      throw new Error(`Unexpected require: ${path}`);
    },
  });
});

import { register } from "./get_me.js";

describe("get_me tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_me");
  });

  it("returns bot info with mcp_version and build fingerprint", async () => {
    const bot = { id: 1, is_bot: true, first_name: "Bot", username: "test_bot" };
    mocks.getMe.mockResolvedValue(bot);
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual({
      mcp_version: "0.0.0-test",
      mcp_commit: "t3stc0mm",
      mcp_build_time: "2025-01-01T00:00:00.000Z",
      ...bot,
    });
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
