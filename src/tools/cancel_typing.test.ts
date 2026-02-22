import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  cancelTyping: vi.fn(),
}));

vi.mock("../typing-state.js", () => ({
  cancelTyping: mocks.cancelTyping,
}));

import { register } from "./cancel_typing.js";

describe("cancel_typing tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("cancel_typing");
  });

  it("calls cancelTyping and returns cancelled:true when was active", async () => {
    mocks.cancelTyping.mockReturnValue(true);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.cancelled).toBe(true);
    expect(mocks.cancelTyping).toHaveBeenCalledOnce();
  });

  it("returns cancelled:false when nothing was running", async () => {
    mocks.cancelTyping.mockReturnValue(false);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.cancelled).toBe(false);
    expect(mocks.cancelTyping).toHaveBeenCalledOnce();
  });
});
