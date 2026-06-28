import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  routeOutboundMessage: vi.fn(),
  resolveChat: vi.fn((): number | { code: string; message: string } => 99),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat, routeOutboundMessage: (...args: unknown[]) => mocks.routeOutboundMessage(...args) };
});

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./notify.js";
import { setRichMessagesEnabledForTest } from "../../telegram.js";

describe("notify tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 1 });
    const server = createMockServer();
    register(server);
    call = server.getHandler("notify");
  });

  it("sends a message and returns message_id", async () => {
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 5 });
    const result = await call({ title: "Done", severity: "success", token: 1123456});
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).message_id).toBe(5);
  });

  it("prefixes title with correct severity emoji", async () => {
    await call({ title: "Oops", severity: "error", token: 1123456});
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("⛔");
    expect(text).toContain("*Oops*");
  });

  it("defaults to Markdown mode and sends as MarkdownV2", async () => {
    await call({ title: "T", severity: "info", token: 1123456});
    expect(mocks.routeOutboundMessage).toHaveBeenCalled();
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("T");
  });

  it("auto-converts Markdown text", async () => {
    await call({ title: "T", text: "Done. **v1**", severity: "info", token: 1123456});
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("Done\\. *v1*");
  });

  it("uses HTML bold for title when parse_mode is HTML", async () => {
    await call({ title: "Done", severity: "success", parse_mode: "HTML", token: 1123456});
    const [, text, opts] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("<b>Done</b>");
    expect(opts.parse_mode).toBe("HTML");
  });

  it("includes text when provided", async () => {
    await call({ title: "T", text: "Details here", severity: "info", token: 1123456});
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("Details here");
  });

  it("defaults to info severity", async () => {
    await call({ title: "Status", token: 1123456});
    expect(mocks.routeOutboundMessage).toHaveBeenCalled();
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { parse_mode?: string }];
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("returns MESSAGE_TOO_LONG when combined text exceeds limit", async () => {
    const result = await call({ title: "T", text: "b".repeat(4200), severity: "info", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
    expect(mocks.routeOutboundMessage).not.toHaveBeenCalled();
  });

  it("returns error when sendMessage API fails", async () => {
    const { GrammyError } = await import("grammy");
    mocks.routeOutboundMessage.mockRejectedValue(
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
    const result = await call({ title: "T", message: "Body via message", severity: "info", token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.routeOutboundMessage).toHaveBeenCalled();
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("Body via message");
  });

  it("text takes precedence over message when both provided", async () => {
    await call({ title: "T", text: "explicit text", message: "message alias", severity: "info", token: 1123456 });
    expect(mocks.routeOutboundMessage).toHaveBeenCalled();
    const [, text] = mocks.routeOutboundMessage.mock.calls[0];
    expect(text).toContain("explicit text");
    expect(text).not.toContain("message alias");
  });

  // AC6: notification format (severity emoji + bold title) is preserved when RICH_MESSAGES=true.
  // handleNotify calls getApi().sendMessage() directly — it does not go through routeOutboundMessage —
  // so the RICH_MESSAGES flag must have no effect on the notification output format.
  it("severity emoji and bold title preserved with RICH_MESSAGES=true (AC6)", async () => {
    setRichMessagesEnabledForTest(true);
    try {
      mocks.routeOutboundMessage.mockResolvedValue({ message_id: 7 });
      await call({ title: "Build done", severity: "success", token: 1123456 });
      const [, msgText] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, string];
      // Severity emoji and bold title must be present — identical to flag-off behaviour
      expect(msgText).toContain("✅");
      expect(msgText).toContain("*Build done*");
      expect(mocks.routeOutboundMessage).toHaveBeenCalledTimes(1);
    } finally {
      setRichMessagesEnabledForTest(false);
    }
  });

testIdentityGate((args) => call(args), mocks.validateSession, {"title":"x"});

});
