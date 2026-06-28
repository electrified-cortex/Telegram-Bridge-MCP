import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  routeOutboundMessage: vi.fn(),
  pinChatMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 1),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
    routeOutboundMessage: (...args: unknown[]) => mocks.routeOutboundMessage(...args),
  };
});

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register, renderProgress } from "./new.js";

describe("send_new_progress tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.pinChatMessage.mockResolvedValue(true);
    mocks.routeOutboundMessage.mockResolvedValue({ message_id: 42 });
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_new_progress");
  });

  it("creates a new message and returns message_id + hint", async () => {
    const result = await call({ percent: 50, title: "Building", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeUndefined();
    expect(mocks.routeOutboundMessage).toHaveBeenCalledOnce();
  });

  it("renders title in HTML bold", async () => {
    await call({ percent: 0, title: "Compiling", token: 1123456});
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { richMessage: { html: string } }];
    expect(opts.richMessage.html).toContain("<b>Compiling</b>");
  });

  it("omits title when not provided", async () => {
    await call({ percent: 50, token: 1123456});
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { richMessage: { html: string } }];
    expect(opts.richMessage.html).not.toContain("<b>");
  });

  it("omits title when empty string is passed", async () => {
    await call({ percent: 50, title: "", token: 1123456});
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { richMessage: { html: string } }];
    expect(opts.richMessage.html).not.toContain("<b>");
  });

  it("renders subtext in HTML italic", async () => {
    await call({ percent: 50, title: "T", subtext: "12 / 24 files", token: 1123456});
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { richMessage: { html: string } }];
    expect(opts.richMessage.html).toContain("<i>12 / 24 files</i>");
  });

  it("omits italic line when no subtext", async () => {
    await call({ percent: 50, title: "T", token: 1123456});
    const [, , opts] = mocks.routeOutboundMessage.mock.calls[0] as [unknown, unknown, { richMessage: { html: string } }];
    expect(opts.richMessage.html).not.toContain("<i>");
  });
  
  it("creates message without title using only percent", async () => {
    const result = await call({ percent: 100, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ percent: 50, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await call({ percent: 50, title: "T", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("auto-pins the message after sending (silent)", async () => {
    await call({ percent: 50, title: "Building", token: 1123456 });
    expect(mocks.pinChatMessage).toHaveBeenCalledWith(1, 42, { disable_notification: true });
  });

  testIdentityGate((args) => call(args), mocks.validateSession, {"percent":50});
});

describe("renderProgress", () => {
  it("renders 0% as all empty blocks", () => {
    const text = renderProgress(0, 10, "T");
    expect(text).toContain("░░░░░░░░░░  0%");
  });

  it("renders 100% as all filled blocks", () => {
    const text = renderProgress(100, 10, "T");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders 50% as half filled", () => {
    const text = renderProgress(50, 10, "T");
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("respects custom width", () => {
    const text = renderProgress(50, 4, "T");
    expect(text).toContain("▓▓░░  50%");
  });

  it("clamps percent above 100", () => {
    const text = renderProgress(120, 10, "T");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("clamps percent below 0", () => {
    const text = renderProgress(-5, 10, "T");
    expect(text).toContain("░░░░░░░░░░  0%");
  });

  it("renders without title when omitted", () => {
    const text = renderProgress(50, 10);
    expect(text).not.toContain("<b>");
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("renders subtext when provided", () => {
    const text = renderProgress(50, 10, "T", "detail");
    expect(text).toContain("<i>detail</i>");
  });

  it("escapes HTML in title and subtext", () => {
    const text = renderProgress(50, 10, "<b>Title</b>", "<i>sub</i>");
    expect(text).not.toContain("<b>Title</b>");
    expect(text).not.toContain("<i>sub</i>");
    // escapeHtml replaces angle brackets
    expect(text).toContain("&lt;b&gt;Title&lt;/b&gt;");
  });
});
