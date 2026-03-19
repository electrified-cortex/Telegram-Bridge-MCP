import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dlog,
  getDebugLog,
  debugLogSize,
  clearDebugLog,
  isDebugEnabled,
  setDebugEnabled,
  resetDebugLogForTest,
} from "./debug-log.js";

beforeEach(() => {
  resetDebugLogForTest();
});

describe("debug-log", () => {
  it("is disabled by default (in test env)", () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it("no-ops when disabled", () => {
    dlog("session", "should not appear");
    expect(debugLogSize()).toBe(0);
  });

  it("logs entries when enabled", () => {
    setDebugEnabled(true);
    dlog("session", "created", { sid: 1 });
    dlog("route", "targeted");
    expect(debugLogSize()).toBe(2);
    const entries = getDebugLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].cat).toBe("session");
    expect(entries[0].msg).toBe("created");
    expect(entries[0].data).toEqual({ sid: 1 });
    expect(entries[1].cat).toBe("route");
  });

  it("writes to stderr when enabled", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDebugEnabled(true);
    dlog("queue", "enqueue test");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[dbg:queue] enqueue test"));
    spy.mockRestore();
  });

  it("filters by category", () => {
    setDebugEnabled(true);
    dlog("session", "a");
    dlog("route", "b");
    dlog("session", "c");
    const filtered = getDebugLog(50, "session");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(e => e.cat === "session")).toBe(true);
  });

  it("respects count limit", () => {
    setDebugEnabled(true);
    for (let i = 0; i < 10; i++) dlog("session", `entry ${i}`);
    const limited = getDebugLog(3);
    expect(limited).toHaveLength(3);
    expect(limited[0].msg).toBe("entry 7");
  });

  it("clears the buffer", () => {
    setDebugEnabled(true);
    dlog("session", "test");
    clearDebugLog();
    expect(debugLogSize()).toBe(0);
    expect(getDebugLog()).toHaveLength(0);
  });

  it("toggles enabled state", () => {
    expect(setDebugEnabled(true)).toBe(true);
    expect(isDebugEnabled()).toBe(true);
    expect(setDebugEnabled(false)).toBe(false);
    expect(isDebugEnabled()).toBe(false);
  });

  it("enforces max buffer size", () => {
    setDebugEnabled(true);
    // Write more than MAX_ENTRIES (2000)
    for (let i = 0; i < 2050; i++) dlog("session", `e${i}`);
    expect(debugLogSize()).toBe(2000);
    // Oldest entries should be trimmed
    const entries = getDebugLog(1);
    expect(entries[0].msg).toBe("e2049");
  });

  it("assigns auto-incrementing ids to entries", () => {
    setDebugEnabled(true);
    dlog("session", "first");
    dlog("route", "second");
    dlog("queue", "third");
    const entries = getDebugLog(10);
    expect(entries[0].id).toBe(1);
    expect(entries[1].id).toBe(2);
    expect(entries[2].id).toBe(3);
  });

  it("filters by since (cursor-based pagination)", () => {
    setDebugEnabled(true);
    dlog("session", "a");
    dlog("session", "b");
    dlog("session", "c");
    const all = getDebugLog(10);
    // Get only entries after the first one
    const after = getDebugLog(10, undefined, all[0].id);
    expect(after).toHaveLength(2);
    expect(after[0].msg).toBe("b");
    expect(after[1].msg).toBe("c");
  });

  it("combines since with category filter", () => {
    setDebugEnabled(true);
    dlog("session", "s1");
    dlog("route", "r1");
    dlog("session", "s2");
    dlog("route", "r2");
    const allSession = getDebugLog(10, "session");
    // since first session entry, only "s2" should remain
    const after = getDebugLog(10, "session", allSession[0].id);
    expect(after).toHaveLength(1);
    expect(after[0].msg).toBe("s2");
  });
});
