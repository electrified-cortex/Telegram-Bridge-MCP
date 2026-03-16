import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  getDebugLog: vi.fn(),
  debugLogSize: vi.fn(),
  isDebugEnabled: vi.fn(),
  setDebugEnabled: vi.fn(),
}));

vi.mock("../debug-log.js", () => ({
  getDebugLog: mocks.getDebugLog,
  debugLogSize: mocks.debugLogSize,
  isDebugEnabled: mocks.isDebugEnabled,
  setDebugEnabled: mocks.setDebugEnabled,
}));

vi.mock("../telegram.js", () => ({
  toResult: (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] }),
}));

let handler: ToolHandler;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.isDebugEnabled.mockReturnValue(false);
  mocks.debugLogSize.mockReturnValue(0);
  mocks.getDebugLog.mockReturnValue([]);

  const server = createMockServer();
  const { register } = await import("./get_debug_log.js");
  register(server);
  handler = server.getHandler("get_debug_log");
});

describe("get_debug_log", () => {
  it("returns empty state when no entries", async () => {
    const result = parseResult(await handler({}));
    expect(result).toEqual({ enabled: false, total: 0, returned: 0, entries: [] });
  });

  it("returns entries with default count of 50", async () => {
    const entries = [{ ts: "2025-01-01T00:00:00Z", cat: "session", msg: "test" }];
    mocks.isDebugEnabled.mockReturnValue(true);
    mocks.debugLogSize.mockReturnValue(1);
    mocks.getDebugLog.mockReturnValue(entries);

    const result = parseResult(await handler({}));
    expect(result.enabled).toBe(true);
    expect(result.entries).toEqual(entries);
    expect(mocks.getDebugLog).toHaveBeenCalledWith(50, undefined, undefined);
  });

  it("passes count and category to getDebugLog", async () => {
    mocks.getDebugLog.mockReturnValue([]);
    await handler({ count: 10, category: "route" });
    expect(mocks.getDebugLog).toHaveBeenCalledWith(10, "route", undefined);
  });

  it("passes since for cursor-based pagination", async () => {
    mocks.getDebugLog.mockReturnValue([]);
    await handler({ since: 42 });
    expect(mocks.getDebugLog).toHaveBeenCalledWith(50, undefined, 42);
  });

  it("toggles debug on when enable=true", async () => {
    mocks.getDebugLog.mockReturnValue([]);
    await handler({ enable: true });
    expect(mocks.setDebugEnabled).toHaveBeenCalledWith(true);
  });

  it("toggles debug off when enable=false", async () => {
    mocks.getDebugLog.mockReturnValue([]);
    await handler({ enable: false });
    expect(mocks.setDebugEnabled).toHaveBeenCalledWith(false);
  });

  it("does not call setDebugEnabled when enable is omitted", async () => {
    mocks.getDebugLog.mockReturnValue([]);
    await handler({});
    expect(mocks.setDebugEnabled).not.toHaveBeenCalled();
  });
});
