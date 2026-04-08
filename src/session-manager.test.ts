import { describe, it, expect, beforeEach, vi } from "vitest";
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
  touchSession,
  markUnhealthy,
  isHealthy,
  getUnhealthySessions,
  getAvailableColors,
  COLOR_PALETTE,
} from "./session-manager.js";

interface SessionWithoutPin {
  pin?: unknown;
}

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

  it("never assigns the same PIN to two concurrent sessions", () => {
    // Create many sessions and verify no two share a PIN
    const pins = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const s = createSession();
      expect(pins.has(s.pin)).toBe(false);
      pins.add(s.pin);
    }
  });
});

describe("color assignment", () => {
  it("auto-assigns palette colors in order", () => {
    const s1 = createSession("A");
    const s2 = createSession("B");
    const s3 = createSession("C");
    expect(s1.color).toBe(COLOR_PALETTE[0]); // 🟦
    expect(s2.color).toBe(COLOR_PALETTE[1]); // 🟩
    expect(s3.color).toBe(COLOR_PALETTE[2]); // 🟨
  });

  it("accepts a valid unoccupied color hint", () => {
    const s = createSession("A", "🟥");
    expect(s.color).toBe("🟥");
  });

  it("falls back to auto-assign when requested color is already taken", () => {
    createSession("A", "🟦"); // takes 🟦
    const s2 = createSession("B", "🟦"); // 🟦 taken → auto-assign next = 🟩
    expect(s2.color).toBe("🟩");
  });

  it("wraps around when all 6 palette colors are in use", () => {
    for (let i = 0; i < 6; i++) createSession(`S${i}`);
    const s7 = createSession("S7");
    // 6 sessions in map → size % 6 === 0 → COLOR_PALETTE[0]
    expect(s7.color).toBe(COLOR_PALETTE[0]);
  });

  it("forceColor=true assigns the requested color even when already in use", () => {
    createSession("A", "🟦"); // 🟦 now in use
    const s2 = createSession("B", "🟦", true); // force: operator explicitly chose 🟦
    expect(s2.color).toBe("🟦");
  });

  it("forceColor=false (default) falls back when requested color is in use", () => {
    createSession("A", "🟦"); // 🟦 now in use
    const s2 = createSession("B", "🟦"); // no force: fall back to LRU auto-assign
    expect(s2.color).not.toBe("🟦");
  });

  it("listSessions includes color", () => {
    createSession("A");
    createSession("B");
    const list = listSessions();
    expect(list[0].color).toBe(COLOR_PALETTE[0]);
    expect(list[1].color).toBe(COLOR_PALETTE[1]);
  });

  it("getSession includes color", () => {
    const s = createSession("A");
    expect(getSession(s.sid)?.color).toBe(COLOR_PALETTE[0]);
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
    const first = list[0] as unknown as SessionWithoutPin;
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

describe("health tracking", () => {
  it("new sessions start healthy with no lastPollAt", () => {
    const s = createSession("alpha");
    expect(isHealthy(s.sid)).toBe(true);
    const raw = getSession(s.sid);
    expect(raw?.lastPollAt).toBeUndefined();
  });

  describe("touchSession", () => {
    it("records lastPollAt and keeps session healthy", () => {
      const before = Date.now();
      const s = createSession("alpha");
      touchSession(s.sid);
      const raw = getSession(s.sid);
      expect(raw?.lastPollAt).toBeGreaterThanOrEqual(before);
      expect(isHealthy(s.sid)).toBe(true);
    });

    it("restores healthy flag after markUnhealthy", () => {
      const s = createSession("alpha");
      markUnhealthy(s.sid);
      expect(isHealthy(s.sid)).toBe(false);
      touchSession(s.sid);
      expect(isHealthy(s.sid)).toBe(true);
    });

    it("is a no-op for unknown sid", () => {
      expect(() => { touchSession(999); }).not.toThrow();
    });
  });

  describe("markUnhealthy / isHealthy", () => {
    it("markUnhealthy makes isHealthy return false", () => {
      const s = createSession("alpha");
      markUnhealthy(s.sid);
      expect(isHealthy(s.sid)).toBe(false);
    });

    it("isHealthy returns false for unknown sid", () => {
      expect(isHealthy(999)).toBe(false);
    });

    it("markUnhealthy is a no-op for unknown sid", () => {
      expect(() => { markUnhealthy(999); }).not.toThrow();
    });
  });

  describe("getUnhealthySessions", () => {
    it("excludes sessions that have never polled", () => {
      createSession("alpha");
      expect(getUnhealthySessions(0)).toHaveLength(0);
    });

    it("returns sessions whose lastPollAt is before the cutoff", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      // Advance past threshold
      vi.advanceTimersByTime(400_000);
      const unhealthy = getUnhealthySessions(360_000);
      expect(unhealthy).toHaveLength(1);
      expect(unhealthy[0].sid).toBe(s.sid);
      vi.useRealTimers();
    });

    it("excludes sessions that polled recently", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      vi.advanceTimersByTime(100_000); // well within threshold
      expect(getUnhealthySessions(360_000)).toHaveLength(0);
      vi.useRealTimers();
    });

    it("does not expose PINs", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      vi.advanceTimersByTime(400_000);
      const result = getUnhealthySessions(360_000);
      const first = result[0] as unknown as SessionWithoutPin;
      expect(first.pin).toBeUndefined();
      vi.useRealTimers();
    });

    it("only returns sessions that exceed the threshold", () => {
      vi.useFakeTimers();
      const a = createSession("alpha");
      const b = createSession("beta");
      touchSession(a.sid);
      vi.advanceTimersByTime(200_000);
      touchSession(b.sid); // beta just polled
      vi.advanceTimersByTime(200_000); // alpha is now 400s old, beta 200s
      const unhealthy = getUnhealthySessions(360_000);
      expect(unhealthy).toHaveLength(1);
      expect(unhealthy[0].sid).toBe(a.sid);
      vi.useRealTimers();
    });
  });
});

describe("getAvailableColors", () => {
  it("returns all 6 palette colors when no sessions exist", () => {
    const colors = getAvailableColors();
    expect(colors).toEqual([...COLOR_PALETTE]);
  });

  it("orders colors by LRU: never-used before recently-used", () => {
    createSession("A"); // takes 🟦 (LRU moves 🟦 to end)
    createSession("B"); // takes 🟩 (LRU moves 🟩 to end)
    const colors = getAvailableColors();
    expect(colors).toHaveLength(6);
    // Never-used colors must appear before recently-used ones
    const freshIndex = colors.indexOf("🟨"); // never used → toward left
    const usedIndex1 = colors.indexOf("🟦");  // used first → near end
    const usedIndex2 = colors.indexOf("🟩");  // used second → rightmost
    expect(freshIndex).toBeLessThan(usedIndex1);
    expect(freshIndex).toBeLessThan(usedIndex2);
    expect(usedIndex1).toBeLessThan(usedIndex2); // 🟦 used before 🟩, so 🟩 is more recent
  });

  it("unused colors (no active session) appear before in-use colors", () => {
    // 🟦 is in use by an active session; all others are unused
    createSession("A", "🟦");
    const colors = getAvailableColors();
    expect(colors).toHaveLength(6);
    // 🟦 is in-use → must appear after all unused colors
    const inUseIndex = colors.indexOf("🟦");
    for (const c of COLOR_PALETTE) {
      if (c !== "🟦") {
        expect(colors.indexOf(c)).toBeLessThan(inUseIndex);
      }
    }
  });

  it("closing a session moves its color back to the unused group", () => {
    const s = createSession("A", "🟦"); // 🟦 in-use
    const colorsBefore = getAvailableColors();
    // 🟦 should be in the in-use group (last position: most-recently-used and in-use)
    expect(colorsBefore[colorsBefore.length - 1]).toBe("🟦");
    closeSession(s.sid); // 🟦 no longer in-use (but LRU history unchanged)
    const colorsAfter = getAvailableColors();
    // 🟦 was closed → it's now in the unused group
    // All colors are now unused; 🟦 is the most-recently-used among them → rightmost
    expect(colorsAfter[colorsAfter.length - 1]).toBe("🟦");
    expect(colorsAfter).toHaveLength(6);
  });

  it("when all colors are in use, order is pure LRU (no unused group)", () => {
    for (let i = 0; i < 6; i++) createSession(`S${i}`);
    const colors = getAvailableColors();
    expect(colors).toHaveLength(6);
    // All colors in use → no unused group; order is LRU
    expect(new Set(colors)).toEqual(new Set(COLOR_PALETTE));
    // Last color is most-recently-used (COLOR_PALETTE[5] = 🟪, assigned 6th)
    expect(colors[colors.length - 1]).toBe(COLOR_PALETTE[5]);
  });

  it("never-used hint placed at far left", () => {
    const colors = getAvailableColors("🟩");
    expect(colors[0]).toBe("🟩");
    expect(colors).toHaveLength(6);
  });

  it("previously-used hint stays at its natural sorted position, not forced first", () => {
    createSession("A", "🟦"); // 🟦 in-use and most-recently-used
    const colors = getAvailableColors("🟦");
    expect(colors).toHaveLength(6);
    // 🟦 is in-use → sorted to in-use group (last); hint does not force it to position 0
    expect(colors[0]).not.toBe("🟦");
    expect(colors[colors.length - 1]).toBe("🟦");
  });

  it("hint that is not in palette is ignored", () => {
    const colors = getAvailableColors("🔵");
    expect(colors).toEqual([...COLOR_PALETTE]);
  });

  it("returns all 6 when all are taken", () => {
    for (let i = 0; i < 6; i++) createSession(`S${i}`);
    const colors = getAvailableColors();
    expect(colors).toHaveLength(6);
    // All colors present, though order reflects LRU
    expect(new Set(colors)).toEqual(new Set(COLOR_PALETTE));
  });

  it("never-used hint placed first even when 5 others are used", () => {
    // Take 5 colors, leave only 🟪 never-used
    createSession("A", "🟦");
    createSession("B", "🟩");
    createSession("C", "🟨");
    createSession("D", "🟧");
    createSession("E", "🟥");
    const colors = getAvailableColors("🟪");
    expect(colors).toHaveLength(6);
    expect(colors[0]).toBe("🟪"); // never-used hint goes first
    expect(colors.slice(1)).toEqual(expect.arrayContaining(["🟦", "🟩", "🟨", "🟧", "🟥"]));
  });

  it("assignment order is reflected in LRU position within the in-use group", () => {
    // Assign in a non-palette order; verify LRU reflects assignment recency within in-use group
    createSession("A", "🟥"); // 🟥 in-use, used first
    createSession("B", "🟨"); // 🟨 in-use, used second (most recent)
    const colors = getAvailableColors();
    // 🟥 and 🟨 are both in-use → appear last; 🟨 more recent → rightmost
    expect(colors[colors.length - 1]).toBe("🟨");
    expect(colors[colors.length - 2]).toBe("🟥");
    // Never-used + not-in-use colors come before both
    const unusedGroup = ["🟦", "🟩", "🟧", "🟪"];
    for (const c of unusedGroup) {
      expect(colors.indexOf(c)).toBeLessThan(colors.indexOf("🟥"));
    }
  });

  it("closing a session does not change LRU order — all colors always present", () => {
    const s = createSession("A", "🟦"); // 🟦 → MRU
    closeSession(s.sid);
    const colors = getAvailableColors();
    // 🟦 session closed → no longer in-use; now in unused group at rightmost (MRU within unused)
    expect(colors[colors.length - 1]).toBe("🟦");
    expect(colors).toHaveLength(6);
  });

  it("two active sessions: their colors are in in-use group; rest are in unused group", () => {
    createSession("A", "🟨"); // 🟨 in-use
    createSession("B", "🟪"); // 🟪 in-use, more recent
    const colors = getAvailableColors();
    const unusedColors = ["🟦", "🟩", "🟧", "🟥"];
    const inUseColors = ["🟨", "🟪"];
    // All unused colors appear before all in-use colors
    const maxUnusedIdx = Math.max(...unusedColors.map(c => colors.indexOf(c)));
    const minInUseIdx = Math.min(...inUseColors.map(c => colors.indexOf(c)));
    expect(maxUnusedIdx).toBeLessThan(minInUseIdx);
  });
});
