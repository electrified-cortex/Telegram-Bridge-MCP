import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

const mocks = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getVersions: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual };
});

vi.mock("../message-store.js", () => ({
  getMessage: mocks.getMessage,
  getVersions: mocks.getVersions,
  CURRENT: -1,
}));

import { register } from "./get_message.js";

function makeEvent(id: number, text: string, extra?: Partial<TimelineEvent>): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "bot",
    content: { type: "text", text },
    ...extra,
  };
}

describe("get_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_message");
  });

  it("returns message by id with default version (current)", async () => {
    const event = makeEvent(10, "Hello world");
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1, 0]);
    const result = await call({ message_id: 10 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.id).toBe(10);
    expect(data.event).toBe("message");
    expect(data.versions).toEqual([-1, 0]);
    expect(mocks.getMessage).toHaveBeenCalledWith(10, -1);
  });

  it("returns specific version when requested", async () => {
    const event = makeEvent(10, "Original");
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1, 0, 1]);
    const result = await call({ message_id: 10, version: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.id).toBe(10);
    expect(mocks.getMessage).toHaveBeenCalledWith(10, 0);
  });

  it("returns MESSAGE_NOT_FOUND for missing message_id", async () => {
    mocks.getMessage.mockReturnValue(undefined);
    const result = await call({ message_id: 999 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_NOT_FOUND");
  });

  it("returns MESSAGE_NOT_FOUND for missing version", async () => {
    mocks.getMessage.mockReturnValue(undefined);
    const result = await call({ message_id: 10, version: 5 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_NOT_FOUND");
  });

  it("includes version history in the response", async () => {
    const event = makeEvent(10, "Current text");
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1, 0, 1, 2]);
    const result = await call({ message_id: 10 });
    const data = parseResult(result);
    expect(data.versions).toEqual([-1, 0, 1, 2]);
  });

  it("does not include raw message data (stripped for compact output)", async () => {
    const rawMessage = { message_id: 10, text: "Hello", chat: { id: 42 } };
    const event = makeEvent(10, "Hello", {
      _update: { update_id: 1, message: rawMessage } as never,
    });
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1]);
    const result = await call({ message_id: 10 });
    const data = parseResult(result);
    expect(data.raw).toBeUndefined();
    expect(data._update).toBeUndefined();
  });

  it("does not include raw callback_query data", async () => {
    const rawCb = { id: "cb1", data: "yes" };
    const event = makeEvent(10, "Button press", {
      _update: { update_id: 2, callback_query: rawCb } as never,
    });
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1]);
    const result = await call({ message_id: 10 });
    const data = parseResult(result);
    expect(data.raw).toBeUndefined();
  });

  it("excludes _update from the response", async () => {
    const event = makeEvent(10, "Test", {
      _update: { update_id: 1 } as never,
    });
    mocks.getMessage.mockReturnValue(event);
    mocks.getVersions.mockReturnValue([-1]);
    const result = await call({ message_id: 10 });
    const data = parseResult(result);
    expect(data._update).toBeUndefined();
  });
});
