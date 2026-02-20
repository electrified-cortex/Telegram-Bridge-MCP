import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "99" };
});

import { register } from "./notify.js";

describe("notify tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("notify");
  });

  it("sends a message and returns message_id", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 5, chat: { id: 99 }, date: 0, text: "" });
    const result = await call({ title: "Done", severity: "success" });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).message_id).toBe(5);
  });

  it("prefixes title with correct severity emoji", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Oops", severity: "error" });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("❌");
    expect(text).toContain("*Oops*");
  });

  it("defaults to Markdown mode and sends as MarkdownV2", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", severity: "info" });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("auto-converts Markdown body", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", body: "Done. **v1**", severity: "info" });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("Done\\. *v1*");
  });

  it("uses HTML bold for title when parse_mode is HTML", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Done", severity: "success", parse_mode: "HTML" });
    const [, text, opts] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<b>Done</b>");
    expect(opts.parse_mode).toBe("HTML");
  });

  it("includes body when provided", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", body: "Details here", severity: "info" });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("Details here");
  });

  it("defaults to info severity", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Status" });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("ℹ️");
  });

  it("returns MESSAGE_TOO_LONG when combined text exceeds limit", async () => {
    const result = await call({ title: "T", body: "b".repeat(4200), severity: "info" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
