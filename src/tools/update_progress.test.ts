import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  editMessageText: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => 1 };
});

import { register } from "./update_progress.js";

describe("update_progress tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("update_progress");
  });

  it("edits message in-place and returns updated: true", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, title: "Building", percent: 75 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.updated).toBe(true);
    expect(data.message_id).toBe(10);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
  });

  it("renders updated bar with bold title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, title: "Building", percent: 100 });
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<b>Building</b>");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders subtext when provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, title: "T", percent: 50, subtext: "half done" });
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<i>half done</i>");
  });

  it("handles boolean result from editMessageText (Telegram unchanged)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, title: "T", percent: 50 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.updated).toBe(true);
  });
});
