import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  elegantShutdown: vi.fn((): Promise<never> => new Promise(() => {})),
  pendingCount: vi.fn((): number => 0),
}));

vi.mock("../shutdown.js", () => ({
  elegantShutdown: mocks.elegantShutdown,
}));

vi.mock("../message-store.js", () => ({
  pendingCount: mocks.pendingCount,
}));

import { register } from "./shutdown.js";

describe("shutdown tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("shutdown");
  });

  it("triggers elegantShutdown when queue is empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.shutting_down).toBe(true);
    // elegantShutdown is called via setImmediate — run pending microtasks
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("returns PENDING_MESSAGES error when queue has items and force is not set", async () => {
    mocks.pendingCount.mockReturnValue(3);
    const result = await call({});
    expect(isError(result)).toBe(true);
    const err = parseResult(result);
    expect(err.code).toBe("PENDING_MESSAGES");
    expect(err.message).toContain("3 pending");
    expect(mocks.elegantShutdown).not.toHaveBeenCalled();
  });

  it("bypasses pending guard when force: true", async () => {
    mocks.pendingCount.mockReturnValue(5);
    const result = parseResult(await call({ force: true }));
    expect(result.shutting_down).toBe(true);
    expect(result.pending_flushed).toBe(5);
    await new Promise<void>((r) => setImmediate(r));
    expect(mocks.elegantShutdown).toHaveBeenCalledTimes(1);
  });

  it("includes pending_flushed: 0 in result when queue is empty", async () => {
    mocks.pendingCount.mockReturnValue(0);
    const result = parseResult(await call({}));
    expect(result.pending_flushed).toBe(0);
  });
});
