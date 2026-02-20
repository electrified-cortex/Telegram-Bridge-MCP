import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));
const offsetMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  reset: vi.fn(),
  get: vi.fn(() => 0),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: offsetMocks.get,
    advanceOffset: offsetMocks.advance,
    resetOffset: offsetMocks.reset,
  };
});

import { register } from "./get_updates.js";

describe("get_updates tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    offsetMocks.get.mockReturnValue(0);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_updates");
  });

  it("returns updates and advances offset", async () => {
    const updates = [{ update_id: 1, message: { message_id: 1, text: "hi", chat: { id: 42 } } }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout: 0 });
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual([{ type: "message", message_id: 1, text: "hi" }]);
    expect(offsetMocks.advance).toHaveBeenCalledWith(updates);
  });

  it("calls resetOffset when reset_offset is true", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout: 0, reset_offset: true });
    expect(offsetMocks.reset).toHaveBeenCalled();
  });

  it("passes limit and timeout to API", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 5, timeout: 10 });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.limit).toBe(5);
    expect(opts.timeout).toBe(10);
  });

  it("filters by allowed_updates when provided", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout: 0, allowed_updates: ["message"] });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.allowed_updates).toEqual(["message"]);
  });
});
