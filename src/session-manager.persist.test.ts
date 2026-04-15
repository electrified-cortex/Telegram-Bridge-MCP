/**
 * Tests for persistSessions / restoreSessions / markPlannedBounce.
 * Uses vi.mock("node:fs") to avoid real disk I/O.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  stderrWrite: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  default: {},
}));

import {
  createSession,
  listSessions,
  resetSessions,
  persistSessions,
  restoreSessions,
  markPlannedBounce,
  type PersistedSessionState,
} from "./session-manager.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetSessions();
  vi.spyOn(process.stderr, "write").mockImplementation(mocks.stderrWrite);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistSessions", () => {
  it("writes valid JSON with sessions array and nextId", () => {
    createSession("Alice");
    createSession("Bob");
    vi.clearAllMocks(); // clear calls from createSession's auto-persist
    persistSessions();

    expect(mocks.writeFileSync).toHaveBeenCalled();
    const [, content] = mocks.writeFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as PersistedSessionState;
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions.map((s) => s.name)).toContain("Alice");
    expect(parsed.sessions.map((s) => s.name)).toContain("Bob");
    expect(parsed.nextId).toBeGreaterThanOrEqual(3);
    expect(parsed.plannedBounce).toBe(false);
  });

  it("writes to SESSION_STATE_PATH (project root)", () => {
    vi.clearAllMocks();
    persistSessions();
    const [writePath] = mocks.writeFileSync.mock.calls[0] as [string];
    expect(writePath).toMatch(/session-state\.json$/);
  });

  it("writes empty sessions array when no sessions", () => {
    vi.clearAllMocks();
    persistSessions();
    const [, content] = mocks.writeFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as PersistedSessionState;
    expect(parsed.sessions).toEqual([]);
  });

  it("swallows writeFileSync errors without throwing", () => {
    mocks.writeFileSync.mockImplementation(() => { throw new Error("EROFS"); });
    expect(() => { persistSessions(); }).not.toThrow();
  });

  it("stores sid, pin, name, color, createdAt for each session", () => {
    createSession("Carol");
    vi.clearAllMocks();
    persistSessions();
    const [, content] = mocks.writeFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as PersistedSessionState;
    const s = parsed.sessions[0];
    expect(typeof s.sid).toBe("number");
    expect(typeof s.pin).toBe("number");
    expect(s.name).toBe("Carol");
    expect(typeof s.color).toBe("string");
    expect(typeof s.createdAt).toBe("string");
  });
});

describe("restoreSessions", () => {
  it("returns false when file does not exist", () => {
    mocks.existsSync.mockReturnValue(false);
    expect(restoreSessions()).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("not json");
    expect(restoreSessions()).toBe(false);
  });

  it("returns false when sessions is not an array", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({ nextId: 1, sessions: "bad", plannedBounce: false }));
    expect(restoreSessions()).toBe(false);
  });

  it("restores sessions into in-memory state", () => {
    const state: PersistedSessionState = {
      nextId: 3,
      sessions: [
        { sid: 1, pin: 100001, name: "Governor", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" },
        { sid: 2, pin: 200002, name: "Worker", color: "🟩", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      plannedBounce: false,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(state));

    restoreSessions();

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.name)).toContain("Governor");
    expect(sessions.map(s => s.name)).toContain("Worker");
  });

  it("returns false when plannedBounce is false or absent", () => {
    const state: PersistedSessionState = {
      nextId: 2,
      sessions: [{ sid: 1, pin: 100001, name: "X", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" }],
      plannedBounce: false,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(state));
    expect(restoreSessions()).toBe(false);
  });

  it("returns true when plannedBounce is true", () => {
    const state: PersistedSessionState = {
      nextId: 2,
      sessions: [{ sid: 1, pin: 100001, name: "X", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" }],
      plannedBounce: true,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(state));
    expect(restoreSessions()).toBe(true);
  });

  it("seeds _nextId above max restored SID", () => {
    const state: PersistedSessionState = {
      nextId: 3,
      sessions: [
        { sid: 5, pin: 500001, name: "X", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" },
        { sid: 9, pin: 900001, name: "Y", color: "🟩", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      plannedBounce: false,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(state));

    restoreSessions();

    // New sessions should have SIDs above 9
    const fresh = createSession("Fresh");
    expect(fresh.sid).toBeGreaterThan(9);
  });

  it("clears plannedBounce from file after reading it", () => {
    const state: PersistedSessionState = {
      nextId: 2,
      sessions: [],
      plannedBounce: true,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(state));

    restoreSessions();

    // writeFileSync should be called to clear plannedBounce
    expect(mocks.writeFileSync).toHaveBeenCalled();
    const lastCall = mocks.writeFileSync.mock.calls[mocks.writeFileSync.mock.calls.length - 1] as [string, string];
    const cleared = JSON.parse(lastCall[1]) as PersistedSessionState;
    expect(cleared.plannedBounce).toBe(false);
  });
});

describe("markPlannedBounce", () => {
  it("sets plannedBounce to true in the written file", () => {
    mocks.existsSync.mockReturnValue(false);
    markPlannedBounce();

    expect(mocks.writeFileSync).toHaveBeenCalled();
    const [, content] = mocks.writeFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as PersistedSessionState;
    expect(parsed.plannedBounce).toBe(true);
  });

  it("writes in-memory sessions (not stale disk state) with plannedBounce true", () => {
    // Add an in-memory session — this is what should be written
    createSession("Gov");
    vi.clearAllMocks(); // ignore the auto-persist from createSession

    // Disk has different/stale content — should be ignored
    const stale: PersistedSessionState = {
      nextId: 99,
      sessions: [{ sid: 50, pin: 500001, name: "Stale", color: "🟥", createdAt: "2020-01-01T00:00:00.000Z" }],
      plannedBounce: false,
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(stale));

    markPlannedBounce();

    const [, content] = mocks.writeFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as PersistedSessionState;
    expect(parsed.plannedBounce).toBe(true);
    // Should write in-memory session, not stale disk session
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].name).toBe("Gov");
  });

  it("swallows errors without throwing", () => {
    mocks.writeFileSync.mockImplementation(() => { throw new Error("EACCES"); });
    expect(() => { markPlannedBounce(); }).not.toThrow();
  });
});
