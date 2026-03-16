import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getSession,
  closeSession,
  validateSession,
  listSessions,
  resetSessions,
  activeSessionCount,
  setActiveSession,
  getActiveSession,
} from "./session-manager.js";

beforeEach(() => {
  resetSessions();
});

describe("createSession", () => {
  it("returns incrementing session IDs starting at 1", () => {
    const a = createSession();
    const b = createSession();
    const c = createSession();
    expect(a.sid).toBe(1);
    expect(b.sid).toBe(2);
    expect(c.sid).toBe(3);
  });

  it("generates a 6-digit numeric PIN", () => {
    const s = createSession();
    expect(s.pin).toBeGreaterThanOrEqual(100_000);
    expect(s.pin).toBeLessThanOrEqual(999_999);
  });

  it("generates unique PINs across sessions", () => {
    const pins = new Set<number>();
    for (let i = 0; i < 20; i++) {
      pins.add(createSession().pin);
    }
    // With 900k possible PINs, 20 should all be unique
    expect(pins.size).toBe(20);
  });

  it("stores an optional session name", () => {
    const s = createSession("my-agent");
    expect(s.name).toBe("my-agent");
  });

  it("defaults name to empty string when omitted", () => {
    const s = createSession();
    expect(s.name).toBe("");
  });

  it("returns the active session count", () => {
    const a = createSession();
    expect(a.sessionsActive).toBe(1);
    const b = createSession();
    expect(b.sessionsActive).toBe(2);
  });
});

describe("getSession", () => {
  it("returns the session object by ID", () => {
    const created = createSession("worker");
    const got = getSession(created.sid);
    expect(got).toBeDefined();
    expect(got!.sid).toBe(created.sid);
    expect(got!.pin).toBe(created.pin);
    expect(got!.name).toBe("worker");
  });

  it("returns undefined for nonexistent session", () => {
    expect(getSession(999)).toBeUndefined();
  });

  it("returns undefined for a closed session", () => {
    const s = createSession();
    closeSession(s.sid);
    expect(getSession(s.sid)).toBeUndefined();
  });
});

describe("validateSession", () => {
  it("returns true for valid sid + pin", () => {
    const s = createSession();
    expect(validateSession(s.sid, s.pin)).toBe(true);
  });

  it("returns false for wrong PIN", () => {
    const s = createSession();
    expect(validateSession(s.sid, s.pin + 1)).toBe(false);
  });

  it("returns false for nonexistent session", () => {
    expect(validateSession(42, 123456)).toBe(false);
  });

  it("returns false for closed session", () => {
    const s = createSession();
    closeSession(s.sid);
    expect(validateSession(s.sid, s.pin)).toBe(false);
  });
});

describe("closeSession", () => {
  it("removes the session from the active list", () => {
    const s = createSession();
    expect(activeSessionCount()).toBe(1);
    closeSession(s.sid);
    expect(activeSessionCount()).toBe(0);
  });

  it("returns true when the session existed", () => {
    const s = createSession();
    expect(closeSession(s.sid)).toBe(true);
  });

  it("returns false for nonexistent session", () => {
    expect(closeSession(999)).toBe(false);
  });

  it("does not affect other sessions", () => {
    const a = createSession("a");
    const b = createSession("b");
    closeSession(a.sid);
    expect(getSession(b.sid)).toBeDefined();
    expect(activeSessionCount()).toBe(1);
  });

  it("does not reset the ID counter after closure", () => {
    createSession();
    const b = createSession();
    closeSession(b.sid);
    const c = createSession();
    expect(c.sid).toBe(3);
  });
});

describe("listSessions", () => {
  it("returns empty array when no sessions exist", () => {
    expect(listSessions()).toEqual([]);
  });

  it("returns all active sessions", () => {
    createSession("alpha");
    createSession("beta");
    const list = listSessions();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("alpha");
    expect(list[1].name).toBe("beta");
  });

  it("excludes closed sessions", () => {
    const a = createSession("alpha");
    createSession("beta");
    closeSession(a.sid);
    const list = listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("beta");
  });

  it("does not expose PINs", () => {
    createSession();
    const list = listSessions();
    const first = list[0] as Record<string, unknown>;
    expect(first.pin).toBeUndefined();
  });
});

describe("activeSessionCount", () => {
  it("returns 0 when no sessions exist", () => {
    expect(activeSessionCount()).toBe(0);
  });

  it("tracks create and close", () => {
    const a = createSession();
    expect(activeSessionCount()).toBe(1);
    createSession();
    expect(activeSessionCount()).toBe(2);
    closeSession(a.sid);
    expect(activeSessionCount()).toBe(1);
  });
});

describe("resetSessions", () => {
  it("clears all sessions and resets the counter", () => {
    createSession();
    createSession();
    resetSessions();
    expect(activeSessionCount()).toBe(0);
    const fresh = createSession();
    expect(fresh.sid).toBe(1);
  });
});

describe("active session context", () => {
  it("defaults to 0 (no session)", () => {
    expect(getActiveSession()).toBe(0);
  });

  it("set and get round-trip", () => {
    setActiveSession(3);
    expect(getActiveSession()).toBe(3);
  });

  it("resets to 0 on resetSessions", () => {
    setActiveSession(5);
    resetSessions();
    expect(getActiveSession()).toBe(0);
  });
});
