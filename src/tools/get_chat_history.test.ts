import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  dumpTimeline: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual };
});

vi.mock("../message-store.js", () => ({
  dumpTimeline: mocks.dumpTimeline,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./get_chat_history.js";

function makeEvent(id: number, text: string): Omit<TimelineEvent, "_update"> {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text },
  };
}

describe("get_chat_history tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_chat_history");
  });

  it("returns the last 20 events by default", async () => {
    const events = Array.from({ length: 30 }, (_, i) => makeEvent(i + 1, `m${i + 1}`));
    mocks.dumpTimeline.mockReturnValue(events);

    const result = await call({ identity: [1, 123456] });
    expect(isError(result)).toBe(false);

    const data = parseResult<{ events: Array<{ id: number }>; has_more: boolean }>(result);
    expect(data.events).toHaveLength(20);
    expect(data.events[0].id).toBe(11);
    expect(data.events[19].id).toBe(30);
    expect(data.has_more).toBe(true);
  });

  it("respects count when provided", async () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(i + 1, `m${i + 1}`));
    mocks.dumpTimeline.mockReturnValue(events);

    const result = await call({ count: 5, identity: [1, 123456] });
    const data = parseResult<{ events: Array<{ id: number }>; has_more: boolean }>(result);

    expect(data.events.map(e => e.id)).toEqual([6, 7, 8, 9, 10]);
    expect(data.has_more).toBe(true);
  });

  it("returns events before before_id using timeline position", async () => {
    const events = [
      makeEvent(10, "a"),
      makeEvent(-100001, "service"),
      makeEvent(2, "b"),
      makeEvent(-3, "dm"),
      makeEvent(50, "c"),
    ];
    mocks.dumpTimeline.mockReturnValue(events);

    const result = await call({ before_id: -3, count: 2, identity: [1, 123456] });
    const data = parseResult<{ events: Array<{ id: number }>; has_more: boolean }>(result);

    expect(data.events.map(e => e.id)).toEqual([-100001, 2]);
    expect(data.has_more).toBe(true);
  });

  it("returns has_more false when window reaches oldest event", async () => {
    const events = [makeEvent(1, "a"), makeEvent(2, "b"), makeEvent(3, "c")];
    mocks.dumpTimeline.mockReturnValue(events);

    const result = await call({ count: 5, identity: [1, 123456] });
    const data = parseResult<{ events: Array<{ id: number }>; has_more: boolean }>(result);

    expect(data.events.map(e => e.id)).toEqual([1, 2, 3]);
    expect(data.has_more).toBe(false);
  });

  it("returns EVENT_NOT_FOUND when before_id is missing", async () => {
    mocks.dumpTimeline.mockReturnValue([makeEvent(1, "a"), makeEvent(2, "b")]);

    const result = await call({ before_id: 999, identity: [1, 123456] });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EVENT_NOT_FOUND");
  });

  it("fails auth when identity is invalid", async () => {
    mocks.validateSession.mockReturnValue(false);
    mocks.dumpTimeline.mockReturnValue([makeEvent(1, "a")]);

    const result = await call({ identity: [1, 111111] });

    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });
});
