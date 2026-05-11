import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  resolveChat: vi.fn((): number | { code: string; message: string } => 99),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./notify.js";

describe("notify tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("notify");
  });

  it("sends a message and returns message_id", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 5, chat: { id: 99 }, date: 0, text: "" });
    const result = await call({ title: "Done", severity: "success", token: 1123456});
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).message_id).toBe(5);
  });

  it("prefixes title with correct severity emoji", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Oops", severity: "error", token: 1123456});
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("⛔");
    expect(text).toContain("*Oops*");
  });

  it("defaults to Markdown mode and sends as MarkdownV2", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", severity: "info", token: 1123456});
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("auto-converts Markdown text", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", text: "Done. **v1**", severity: "info", token: 1123456});
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("Done\\. *v1*");
  });

  it("uses HTML bold for title when parse_mode is HTML", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Done", severity: "success", parse_mode: "HTML", token: 1123456});
    const [, text, opts] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<b>Done</b>");
    expect(opts.parse_mode).toBe("HTML");
  });

  it("includes text when provided", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "T", text: "Details here", severity: "info", token: 1123456});
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("Details here");
  });

  it("defaults to info severity", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0, text: "" });
    await call({ title: "Status", token: 1123456});
    expect(mocks.sendMessage).toHaveBeenCalled();
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("returns MESSAGE_TOO_LONG when combined text exceeds limit", async () => {
    const result = await call({ title: "T", text: "b".repeat(4200), severity: "info", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("returns error when sendMessage API fails", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendMessage.mockRejectedValue(
      new GrammyError(
        "e",
        { ok: false, error_code: 400, description: "Bad Request: chat not found" },
        "sendMessage",
        {},
      ),
    );
    const result = await call({ title: "Done", severity: "info", token: 1123456});
    expect(isError(result)).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ title: "Done", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("accepts message param as alias for text", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 99 }, date: 0, text: "" });
    const result = await call({ title: "T", message: "Body via message", severity: "info", token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMessage).toHaveBeenCalled();
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("Body via message");
  });

  it("text takes precedence over message when both provided", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 99 }, date: 0, text: "" });
    await call({ title: "T", text: "explicit text", message: "message alias", severity: "info", token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalled();
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("explicit text");
    expect(text).not.toContain("message alias");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"title":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong suffix", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"title":"x","token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"title":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
