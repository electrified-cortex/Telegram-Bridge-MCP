import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 1),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

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
    const result = await call({ percent: 50, title: "Building" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
    expect(data.hint).toBeDefined();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("renders title in HTML bold", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ percent: 0, title: "Compiling" });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).toContain("<b>Compiling</b>");
  });

  it("omits title when not provided", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ percent: 50 });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).not.toContain("<b>");
  });

  it("omits title when empty string is passed", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ percent: 50, title: "" });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).not.toContain("<b>");
  });

  it("renders subtext in HTML italic", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ percent: 50, title: "T", subtext: "12 / 24 files" });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).toContain("<i>12 / 24 files</i>");
  });

  it("omits italic line when no subtext", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ percent: 50, title: "T" });
    const [, text] = mocks.sendMessage.mock.calls[0] as [unknown, string];
    expect(text).not.toContain("<i>");
  });
  
  it("creates message without title using only percent", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 42, chat: { id: 1 }, date: 0 });
    const result = await call({ percent: 100 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(42);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ percent: 50 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "TEXT_TOO_LONG",
      message: "too long",
    });
    const result = await call({ percent: 50, title: "T" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("TEXT_TOO_LONG");
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when multiple sessions active and no identity", async () => {
      mocks.activeSessionCount.mockReturnValueOnce(2);
      const result = await call({"percent":50});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong pin", async () => {
      mocks.activeSessionCount.mockReturnValueOnce(2);
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({"percent":50,"identity":[1,99999]});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when multiple sessions active and identity is valid", async () => {
      mocks.activeSessionCount.mockReturnValueOnce(2);
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({"percent":50,"identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });

    it("proceeds when single session active and no identity (backward compat)", async () => {
      mocks.activeSessionCount.mockReturnValueOnce(1);
      let code: string | undefined;
      try { code = errorCode(await call({"percent":50})); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
    });
  });
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
