import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));
const offsetMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  reset: vi.fn(),
  get: vi.fn(() => 0),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: offsetMocks.get,
    advanceOffset: offsetMocks.advance,
    resetOffset: offsetMocks.reset,
  };
});

vi.mock("../transcribe.js", () => ({
  transcribeWithIndicator: vi.fn().mockResolvedValue("transcribed text"),
}));

import { register } from "./get_updates.js";

describe("get_updates tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    offsetMocks.get.mockReturnValue(0);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_updates");
  });

  it("returns text updates and advances offset", async () => {
    const updates = [{ update_id: 1, message: { message_id: 1, text: "hi", chat: { id: 42 } } }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any[];
    expect(data[0].type).toBe("message");
    expect(data[0].content_type).toBe("text");
    expect(data[0].text).toBe("hi");
    expect(offsetMocks.advance).toHaveBeenCalledWith(updates);
  });

  it("returns document messages with content_type=document", async () => {
    const updates = [{
      update_id: 2,
      message: {
        message_id: 2,
        document: { file_id: "f1", file_unique_id: "u1", file_name: "test.pdf", mime_type: "application/pdf", file_size: 1234 },
        caption: "Here",
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("document");
    expect(data[0].file_id).toBe("f1");
    expect(data[0].file_name).toBe("test.pdf");
    expect(data[0].caption).toBe("Here");
  });

  it("returns photo messages with content_type=photo using largest size", async () => {
    const updates = [{
      update_id: 3,
      message: {
        message_id: 3,
        photo: [
          { file_id: "small", file_unique_id: "s1", width: 100, height: 100 },
          { file_id: "large", file_unique_id: "l1", width: 800, height: 600 },
        ],
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("photo");
    expect(data[0].file_id).toBe("large");
    expect(data[0].width).toBe(800);
  });

  it("calls resetOffset when reset_offset is true", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout_seconds: 0, reset_offset: true });
    expect(offsetMocks.reset).toHaveBeenCalled();
  });

  it("passes limit and timeout to API", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 5, timeout_seconds: 10 });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.limit).toBe(5);
    expect(opts.timeout).toBe(10);
  });

  it("filters by allowed_updates when provided", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout_seconds: 0, allowed_updates: ["message"] });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.allowed_updates).toEqual(["message"]);
  });
});
