import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  editMessageText: vi.fn(),
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
    const result = await call({ message_id: 10, percent: 75 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.updated).toBe(true);
    expect(data.message_id).toBe(10);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
  });

  it("renders updated bar with bold title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, title: "Building" });
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<b>Building</b>");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders bar-only when no title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50 });
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).not.toContain("<b>");
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("renders subtext when provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50, subtext: "half done" });
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<i>half done</i>");
  });

  it("handles boolean result from editMessageText (Telegram unchanged)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, percent: 50 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.updated).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 10, percent: 50 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "TEXT_TOO_LONG",
      message: "too long",
    });
    const result = await call({ message_id: 10, percent: 50 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("TEXT_TOO_LONG");
  });
});
