import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const apiMocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));
const offsetMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  get: vi.fn(() => 0),
}));
const bufferMocks = vi.hoisted(() => ({
  drainN: vi.fn(() => [] as any[]),
  bufferSize: vi.fn(() => 0),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => apiMocks,
    getOffset: offsetMocks.get,
    advanceOffset: offsetMocks.advance,
    // Bypass security filtering — fixture data uses chat.id: 42
    filterAllowedUpdates: (updates: unknown[]) => updates,
  };
});

vi.mock("../update-buffer.js", () => ({
  drainN: (...args: any[]) => bufferMocks.drainN(...args),
  bufferSize: () => bufferMocks.bufferSize(),
  // other exports passthrough (not used by get_update)
  peekBuffer: vi.fn(() => []),
  addToBuffer: vi.fn(),
  clearBuffer: vi.fn(),
}));

vi.mock("../transcribe.js", () => ({
  transcribeWithIndicator: vi.fn().mockResolvedValue("transcribed voice"),
}));

import { register } from "./get_update.js";

describe("get_update tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    offsetMocks.get.mockReturnValue(0);
    bufferMocks.drainN.mockReturnValue([]);
    bufferMocks.bufferSize.mockReturnValue(0);
    apiMocks.getUpdates.mockResolvedValue([]);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_update");
  });

  // ── Empty cases ─────────────────────────────────────────────────────────

  it("returns empty updates with remaining=0 and hint when nothing is available", async () => {
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.updates).toEqual([]);
    expect(data.remaining).toBe(0);
    expect(data.hint).toMatch(/wait_for_message/);
  });

  it("returns empty updates with hint mentioning remaining when buffer has items but all drained", async () => {
    // Buffer was empty but Telegram returns nothing, but bufferSize() > 0 (edge case from race)
    bufferMocks.bufferSize.mockReturnValue(2);
    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.remaining).toBe(2);
    // hint should say "more updates buffered"
    expect(data.hint).toMatch(/get_update/);
  });

  // ── Single update from buffer ──────────────────────────────────────────

  it("returns 1 buffered text update with remaining=0 and no hint", async () => {
    const update = { update_id: 1, message: { message_id: 1, text: "hello", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([update]);
    bufferMocks.bufferSize.mockReturnValue(0);

    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].text).toBe("hello");
    expect(data.updates[0].content_type).toBe("text");
    expect(data.remaining).toBe(0);
    expect(data.hint).toBeUndefined();
  });

  it("returns update with hint when remaining > 0", async () => {
    const update = { update_id: 2, message: { message_id: 2, text: "msg", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([update]);
    bufferMocks.bufferSize.mockReturnValue(3);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.remaining).toBe(3);
    expect(data.hint).toMatch(/3 more update/);
  });

  it("does NOT fetch from Telegram when buffer already satisfies max=1", async () => {
    const update = { update_id: 3, message: { message_id: 3, text: "buf", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([update]);

    await call({ max: 1 });
    expect(apiMocks.getUpdates).not.toHaveBeenCalled();
  });

  // ── Fetching from Telegram when buffer is short ───────────────────────

  it("fetches from Telegram when buffer returns fewer than max", async () => {
    // buffer gives 1, Telegram gives 1 more — for max=2
    const bufUpdate = { update_id: 10, message: { message_id: 10, text: "buf", chat: { id: 42 } } };
    const freshUpdate = { update_id: 11, message: { message_id: 11, text: "fresh", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([bufUpdate]);
    apiMocks.getUpdates.mockResolvedValue([freshUpdate]);
    bufferMocks.bufferSize.mockReturnValue(0);

    const result = await call({ max: 2 });
    const data = parseResult(result) as any;
    expect(data.updates).toHaveLength(2);
    expect(data.updates[0].text).toBe("buf");
    expect(data.updates[1].text).toBe("fresh");
    expect(offsetMocks.advance).toHaveBeenCalledWith([freshUpdate]);
  });

  it("fetches from Telegram when buffer is empty", async () => {
    const freshUpdate = { update_id: 20, message: { message_id: 20, text: "telegram", chat: { id: 42 } } };
    apiMocks.getUpdates.mockResolvedValue([freshUpdate]);
    bufferMocks.bufferSize.mockReturnValue(0);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].text).toBe("telegram");
  });

  // ── max parameter ─────────────────────────────────────────────────────

  it("passes max=1 to drainN by default", async () => {
    await call({});
    expect(bufferMocks.drainN).toHaveBeenCalledWith(1);
  });

  it("passes max=3 to drainN when specified", async () => {
    await call({ max: 3 });
    expect(bufferMocks.drainN).toHaveBeenCalledWith(3);
  });

  it("requests remaining count (max - buffered) from Telegram", async () => {
    bufferMocks.drainN.mockReturnValue([]); // buffer empty
    apiMocks.getUpdates.mockResolvedValue([]);

    await call({ max: 5 });
    const [opts] = apiMocks.getUpdates.mock.calls[0];
    expect(opts.limit).toBe(5);
    expect(opts.timeout).toBe(0);
  });

  // ── Message types ─────────────────────────────────────────────────────

  it("sanitizes document messages from buffer", async () => {
    const update = {
      update_id: 30,
      message: {
        message_id: 30,
        document: { file_id: "fdoc", file_unique_id: "u30", file_name: "report.pdf", mime_type: "application/pdf", file_size: 5000 },
        caption: "See attached",
        chat: { id: 42 },
      },
    };
    bufferMocks.drainN.mockReturnValue([update]);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.updates[0].content_type).toBe("document");
    expect(data.updates[0].file_id).toBe("fdoc");
    expect(data.updates[0].caption).toBe("See attached");
  });

  it("sanitizes photo messages using largest size", async () => {
    const update = {
      update_id: 31,
      message: {
        message_id: 31,
        photo: [
          { file_id: "small", file_unique_id: "s1", width: 100, height: 100 },
          { file_id: "large", file_unique_id: "l1", width: 800, height: 600 },
        ],
        chat: { id: 42 },
      },
    };
    bufferMocks.drainN.mockReturnValue([update]);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.updates[0].content_type).toBe("photo");
    expect(data.updates[0].file_id).toBe("large");
  });

  it("sanitizes callback_query updates", async () => {
    const update = {
      update_id: 32,
      callback_query: {
        id: "cq1",
        from: { id: 99 },
        data: "btn_yes",
        message: { message_id: 32, chat: { id: 42 } },
      },
    };
    bufferMocks.drainN.mockReturnValue([update]);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.updates[0].type).toBe("callback_query");
    expect(data.updates[0].data).toBe("btn_yes");
  });

  // ── Hint wording ──────────────────────────────────────────────────────

  it("hint says singular 'update' when remaining=1", async () => {
    const update = { update_id: 40, message: { message_id: 40, text: "a", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([update]);
    bufferMocks.bufferSize.mockReturnValue(1);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.hint).toMatch(/1 more update[^s]/);
  });

  it("hint says plural 'updates' when remaining=2", async () => {
    const update = { update_id: 41, message: { message_id: 41, text: "b", chat: { id: 42 } } };
    bufferMocks.drainN.mockReturnValue([update]);
    bufferMocks.bufferSize.mockReturnValue(2);

    const result = await call({});
    const data = parseResult(result) as any;
    expect(data.hint).toMatch(/2 more updates/);
  });

  // ── Error handling ───────────────────────────────────────────────────

  it("returns error result when Telegram API throws", async () => {
    apiMocks.getUpdates.mockRejectedValue(new Error("network failure"));

    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
