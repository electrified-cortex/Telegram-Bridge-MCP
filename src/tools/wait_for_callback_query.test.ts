import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: () => 0,
    advanceOffset: vi.fn(),
    filterAllowedUpdates: (updates: any[]) => {
      return updates.filter((u: any) => {
        const chatId = u.callback_query?.message?.chat?.id;
        return chatId === undefined || String(chatId) === "42";
      });
    },
  };
});

import { register } from "./wait_for_callback_query.js";

const makeUpdate = (chat_id: number, message_id: number, data: string) => ({
  update_id: 1,
  callback_query: {
    id: "cq1",
    data,
    from: { id: 10, username: "user", first_name: "User" },
    message: { message_id, chat: { id: chat_id } },
  },
});

describe("wait_for_callback_query tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("wait_for_callback_query");
  });

  it("returns callback data when update arrives", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(42, 7, "action_yes")]);
    const result = await call({ timeout_seconds: 5 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.data).toBe("action_yes");
    expect(data.callback_query_id).toBe("cq1");
    expect(data.chat_id).toBeUndefined();
    expect(data.from).toBeUndefined();
  });

  it("returns timed_out when no callback_query arrives", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters by chat_id", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(999, 1, "data")]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters by message_id", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(42, 99, "data")]);
    const result = await call({ timeout_seconds: 1, message_id: 7 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });
});
