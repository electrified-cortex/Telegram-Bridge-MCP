import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./session-manager.js", () => ({
  getActiveSession: vi.fn(() => 0),
  setActiveSession: vi.fn(),
}));

import { runInSessionContext, getCallerSid } from "./session-context.js";
import { getActiveSession } from "./session-manager.js";

const mockedGetActiveSession = vi.mocked(getActiveSession);

describe("session-context (AsyncLocalStorage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── runInSessionContext ──────────────────────────────────────────────

  it("sets sid for the duration of the callback", () => {
    let captured = 0;
    runInSessionContext(42, () => {
      captured = getCallerSid();
    });
    expect(captured).toBe(42);
  });

  it("returns the callback's return value", () => {
    const result = runInSessionContext(1, () => "hello");
    expect(result).toBe("hello");
  });

  it("returns async callback results", async () => {
    const result = await runInSessionContext(1, async () => {
      await Promise.resolve();
      return "async-value";
    });
    expect(result).toBe("async-value");
  });

  // ── getCallerSid ────────────────────────────────────────────────────

  it("returns fallback (getActiveSession) when no context is set", () => {
    mockedGetActiveSession.mockReturnValue(7);
    expect(getCallerSid()).toBe(7);
  });

  it("prefers AsyncLocalStorage context over getActiveSession", () => {
    mockedGetActiveSession.mockReturnValue(99);
    let captured = 0;
    runInSessionContext(3, () => {
      captured = getCallerSid();
    });
    expect(captured).toBe(3);
    expect(mockedGetActiveSession).not.toHaveBeenCalled();
  });

  // ── Context persistence across awaits ───────────────────────────────

  it("persists context across awaits", async () => {
    const results: number[] = [];
    await runInSessionContext(5, async () => {
      results.push(getCallerSid());
      await Promise.resolve();
      results.push(getCallerSid());
      await new Promise((r) => setTimeout(r, 10));
      results.push(getCallerSid());
    });
    expect(results).toEqual([5, 5, 5]);
  });

  // ── Isolation between concurrent contexts ───────────────────────────

  it("isolates concurrent contexts from each other", async () => {
    const log: string[] = [];

    const task1 = runInSessionContext(1, async () => {
      log.push(`t1-start:${getCallerSid()}`);
      await new Promise((r) => setTimeout(r, 20));
      log.push(`t1-end:${getCallerSid()}`);
    });

    const task2 = runInSessionContext(2, async () => {
      log.push(`t2-start:${getCallerSid()}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`t2-end:${getCallerSid()}`);
    });

    await Promise.all([task1, task2]);

    // Task 2 finishes first (10ms < 20ms)
    expect(log).toContain("t1-start:1");
    expect(log).toContain("t1-end:1");
    expect(log).toContain("t2-start:2");
    expect(log).toContain("t2-end:2");
  });

  it("does not leak context after callback completes", () => {
    runInSessionContext(10, () => {
      // inside context
    });
    mockedGetActiveSession.mockReturnValue(0);
    expect(getCallerSid()).toBe(0);
  });

  // ── Nested contexts ─────────────────────────────────────────────────

  it("supports nested contexts (inner overrides outer)", () => {
    let outer = 0;
    let inner = 0;
    let afterInner = 0;
    runInSessionContext(1, () => {
      outer = getCallerSid();
      runInSessionContext(2, () => {
        inner = getCallerSid();
      });
      afterInner = getCallerSid();
    });
    expect(outer).toBe(1);
    expect(inner).toBe(2);
    expect(afterInner).toBe(1);
  });
});
