import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => 1 };
});

import { register, renderProgress } from "./send_new_progress.js";

describe("send_new_progress tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_new_progress");
  });

  it("creates a new message and returns message_id + hint", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 42, chat: { id: 1 }, date: 0 });
    const result = await call({ title: "Building", percent: 50 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeDefined();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("renders title in HTML bold", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "Compiling", percent: 0 });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).toContain("<b>Compiling</b>");
  });

  it("renders subtext in HTML italic", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "T", percent: 50, subtext: "12 / 24 files" });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).toContain("<i>12 / 24 files</i>");
  });

  it("omits italic line when no subtext", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "T", percent: 50 });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).not.toContain("<i>");
  });
});

describe("renderProgress", () => {
  it("renders 0% as all empty blocks", () => {
    const text = renderProgress("T", 0, 10);
    expect(text).toContain("░░░░░░░░░░  0%");
  });

  it("renders 100% as all filled blocks", () => {
    const text = renderProgress("T", 100, 10);
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders 50% as half filled", () => {
    const text = renderProgress("T", 50, 10);
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("respects custom width", () => {
    const text = renderProgress("T", 50, 4);
    expect(text).toContain("▓▓░░  50%");
  });

  it("clamps percent above 100", () => {
    const text = renderProgress("T", 120, 10);
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("clamps percent below 0", () => {
    const text = renderProgress("T", -5, 10);
    expect(text).toContain("░░░░░░░░░░  0%");
  });

  it("renders subtext when provided", () => {
    const text = renderProgress("T", 50, 10, "detail");
    expect(text).toContain("<i>detail</i>");
  });

  it("escapes HTML in title and subtext", () => {
    const text = renderProgress("<b>Title</b>", 50, 10, "<i>sub</i>");
    expect(text).not.toContain("<b>Title</b>");
    expect(text).not.toContain("<i>sub</i>");
    // escapeHtml replaces angle brackets
    expect(text).toContain("&lt;b&gt;Title&lt;/b&gt;");
  });
});
