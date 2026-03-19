import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, type ToolHandler } from "./test-utils.js";

interface ListSessionsResult {
  sessions: Array<{ sid: number; name: string; createdAt: string }>;
  active_sid: number;
}

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getActiveSession: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  listSessions: mocks.listSessions,
  getActiveSession: mocks.getActiveSession,
}));

import { register } from "./list_sessions.js";

describe("list_sessions tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.getActiveSession.mockReturnValue(0);
    const server = createMockServer();
    register(server);
    call = server.getHandler("list_sessions");
  });

  it("returns empty array when no sessions exist", async () => {
    const result = parseResult<ListSessionsResult>(await call({}));
    expect(result).toEqual({ sessions: [], active_sid: 0 });
  });

  it("returns all sessions without PINs", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "alpha", createdAt: "2026-01-01T00:00:00.000Z" },
      { sid: 2, name: "beta", createdAt: "2026-01-01T00:01:00.000Z" },
    ]);
    mocks.getActiveSession.mockReturnValue(2);

    const result = parseResult<ListSessionsResult>(await call({}));

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toEqual({
      sid: 1,
      name: "alpha",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.sessions[1].sid).toBe(2);
    expect(result.active_sid).toBe(2);
  });

  it("includes active_sid of 0 when no session is active", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mocks.getActiveSession.mockReturnValue(0);

    const result = parseResult<ListSessionsResult>(await call({}));
    expect(result.active_sid).toBe(0);
  });
});
