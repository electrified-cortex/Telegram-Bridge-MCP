import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ editMessageText: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "42" };
});

import { register } from "./edit_message_text.js";

describe("edit_message_text tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("edit_message_text");
  });

  it("calls API with correct positional args", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 1 });
    await call({ message_id: 1, text: "Updated" });
    expect(mocks.editMessageText).toHaveBeenCalledWith("42", 1, "Updated", expect.any(Object));
  });

  it("returns result from API", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 1, text: "Updated" });
    const result = await call({ message_id: 1, text: "Updated" });
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toMatchObject({ message_id: 1 });
  });

  it("returns error when message cannot be edited", async () => {
    const { GrammyError } = await import("grammy");
    mocks.editMessageText.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: message can't be edited" }, "editMessageText", {})
    );
    const result = await call({ message_id: 99, text: "x" });
    expect(isError(result)).toBe(true);
  });
});
