import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  editMessageText: vi.fn(),
  getMessage: vi.fn(),
  recordOutgoingEdit: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({ editMessageText: mocks.editMessageText }),
    resolveChat: () => 42,
  };
});

vi.mock("../message-store.js", () => ({
  getMessage: mocks.getMessage,
  recordOutgoingEdit: mocks.recordOutgoingEdit,
  CURRENT: -1,
}));

import { register } from "./append_text.js";

describe("append_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("append_text");
  });

  it("appends text to existing message with default newline separator", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Line 1" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "Line 2" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.length).toBe("Line 1\nLine 2".length);
  });

  it("passes accumulated text to editMessageText", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Hello" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: " World" });
    // The text passed to editMessageText will be MarkdownV2-resolved
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      expect.any(String),
      expect.objectContaining({ parse_mode: expect.any(String) }),
    );
  });

  it("uses custom separator", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "A" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "B", separator: " | " });
    const data = parseResult(result);
    expect(data.length).toBe("A | B".length);
  });

  it("handles empty current text (first append)", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, text: "First chunk" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.length).toBe("First chunk".length);
  });

  it("returns MESSAGE_NOT_FOUND when message is not in store", async () => {
    mocks.getMessage.mockReturnValue(undefined);
    const result = await call({ message_id: 10, text: "Fresh" });
    expect(isError(result)).toBe(true);
    expect(result.content[0].text).toContain("MESSAGE_NOT_FOUND");
  });

  it("calls recordOutgoingEdit with accumulated text", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "X" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "Y" });
    expect(mocks.recordOutgoingEdit).toHaveBeenCalledWith(10, "text", "X\nY");
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Old" } });
    mocks.editMessageText.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message is not modified" }, "editMessageText", {}),
    );
    const result = await call({ message_id: 10, text: "Same" });
    expect(isError(result)).toBe(true);
  });

  it("handles boolean result from editMessageText", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Inline" } });
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, text: "More" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    // Falls back to the passed message_id when API returns boolean
    expect(data.message_id).toBe(10);
  });

  it("uses MarkdownV2 parse mode by default", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "more" });
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });

  it("passes HTML parse_mode when specified", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "text", text: "Text" } });
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, text: "more", parse_mode: "HTML" });
    expect(mocks.editMessageText).toHaveBeenCalledWith(
      42,
      10,
      "Text\nmore",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("returns error when message has non-text content type", async () => {
    mocks.getMessage.mockReturnValue({ content: { type: "voice" } });
    const result = await call({ message_id: 10, text: "oops" });
    expect(isError(result)).toBe(true);
    expect(result.content[0].text).toContain("MESSAGE_NOT_TEXT");
  });
});
