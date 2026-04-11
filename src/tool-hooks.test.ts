import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setPreToolHook,
  clearPreToolHook,
  invokePreToolHook,
  buildDenyPatternHook,
  resetToolHooksForTest,
  type PreToolHook,
} from "./tool-hooks.js";
import { logBlockedToolCall } from "./server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spy on stderr writes so we can assert [hook:blocked] log lines. */
function captureStderr() {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    lines.push(String(data));
    return true;
  });
  return { lines, spy };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetToolHooksForTest();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Default behaviour (no hook registered)
// ---------------------------------------------------------------------------

describe("default (no hook registered)", () => {
  it("allows any tool call", async () => {
    const result = await invokePreToolHook("send_text", { token: 1123456 });
    expect(result.allowed).toBe(true);
  });

  it("allows calls with arbitrary tool names", async () => {
    const result = await invokePreToolHook("shutdown", {});
    expect(result.allowed).toBe(true);
  });

  it("does not include a reason when allowed", async () => {
    const result = await invokePreToolHook("any_tool", {});
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hook registration / clearing
// ---------------------------------------------------------------------------

describe("setPreToolHook / clearPreToolHook", () => {
  it("registered hook is called on invoke", async () => {
    const hook: PreToolHook = vi.fn(() => ({ allowed: true }));
    setPreToolHook(hook);
    await invokePreToolHook("send_text", {});
    expect(hook).toHaveBeenCalledOnce();
  });

  it("hook receives tool name and args", async () => {
    const hook: PreToolHook = vi.fn(() => ({ allowed: true }));
    setPreToolHook(hook);
    const args = { token: 3781429, text: "hello" };
    await invokePreToolHook("send_text", args);
    expect(hook).toHaveBeenCalledWith("send_text", args);
  });

  it("replacing hook discards the old one", async () => {
    const first: PreToolHook = vi.fn(() => ({ allowed: true }));
    const second: PreToolHook = vi.fn(() => ({ allowed: true }));
    setPreToolHook(first);
    setPreToolHook(second);
    await invokePreToolHook("any_tool", {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("clearPreToolHook restores pass-through behaviour", async () => {
    setPreToolHook(() => ({ allowed: false, reason: "blocked" }));
    clearPreToolHook();
    const result = await invokePreToolHook("any_tool", {});
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blocking behaviour
// ---------------------------------------------------------------------------

describe("hook blocks call", () => {
  it("returns allowed:false when hook blocks", async () => {
    setPreToolHook(() => ({ allowed: false, reason: "not permitted" }));
    const result = await invokePreToolHook("shutdown", {});
    expect(result.allowed).toBe(false);
  });

  it("reason is propagated from hook", async () => {
    setPreToolHook(() => ({ allowed: false, reason: "audit policy" }));
    const result = await invokePreToolHook("download_file", {});
    expect(result.reason).toBe("audit policy");
  });

  it("async hook is awaited correctly", async () => {
    setPreToolHook(async () => {
      await Promise.resolve();
      return { allowed: false, reason: "async block" };
    });
    const result = await invokePreToolHook("send_file", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("async block");
  });
});

// ---------------------------------------------------------------------------
// Hook exception handling
// ---------------------------------------------------------------------------

describe("hook throws or rejects", () => {
  it("returns allowed:false when hook throws synchronously", async () => {
    setPreToolHook(() => {
      throw new Error("sync boom");
    });
    const result = await invokePreToolHook("any_tool", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Hook error:");
    expect(result.reason).toContain("sync boom");
  });

  it("returns allowed:false when hook rejects asynchronously", async () => {
    setPreToolHook(() => {
      return Promise.reject(new Error("async boom"));
    });
    const result = await invokePreToolHook("any_tool", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Hook error:");
    expect(result.reason).toContain("async boom");
  });
});

// ---------------------------------------------------------------------------
// buildDenyPatternHook — pattern matching
// ---------------------------------------------------------------------------

describe("buildDenyPatternHook", () => {
  describe("exact matches", () => {
    it("blocks an exact tool name", () => {
      const hook = buildDenyPatternHook(["shutdown"]);
      expect(hook("shutdown", {})).toMatchObject({ allowed: false });
    });

    it("allows a non-matching tool name", () => {
      const hook = buildDenyPatternHook(["shutdown"]);
      expect(hook("send_text", {})).toMatchObject({ allowed: true });
    });

    it("does not block a partial match", () => {
      const hook = buildDenyPatternHook(["shut"]);
      expect(hook("shutdown", {})).toMatchObject({ allowed: true });
    });
  });

  describe("wildcard (glob) matches", () => {
    it("blocks tools matching a trailing *", () => {
      const hook = buildDenyPatternHook(["download_*"]);
      expect(hook("download_file", {})).toMatchObject({ allowed: false });
    });

    it("blocks tools matching a leading *", () => {
      const hook = buildDenyPatternHook(["*_file"]);
      expect(hook("download_file", {})).toMatchObject({ allowed: false });
      expect(hook("send_file", {})).toMatchObject({ allowed: false });
    });

    it("blocks tools matching a wildcard-only pattern", () => {
      const hook = buildDenyPatternHook(["*"]);
      expect(hook("any_tool", {})).toMatchObject({ allowed: false });
    });

    it("allows tools that don't match the wildcard pattern", () => {
      const hook = buildDenyPatternHook(["download_*"]);
      expect(hook("send_text", {})).toMatchObject({ allowed: true });
    });

    it("treats ? as a literal character, not a regex quantifier", () => {
      const hook = buildDenyPatternHook(["tool_?"]);
      expect(hook("tool_?", {})).toMatchObject({ allowed: false });
      expect(hook("tool_a", {})).toMatchObject({ allowed: true });
    });
  });

  describe("multiple patterns", () => {
    it("blocks when any pattern matches", () => {
      const hook = buildDenyPatternHook(["shutdown", "download_*"]);
      expect(hook("shutdown", {})).toMatchObject({ allowed: false });
      expect(hook("download_file", {})).toMatchObject({ allowed: false });
    });

    it("allows when no pattern matches", () => {
      const hook = buildDenyPatternHook(["shutdown", "download_*"]);
      expect(hook("send_text", {})).toMatchObject({ allowed: true });
    });
  });

  describe("reason in block result", () => {
    it("includes the tool name and matched pattern in reason", async () => {
      const hook = buildDenyPatternHook(["shutdown"]);
      const result = await hook("shutdown", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("shutdown");
    });

    it("includes the wildcard pattern in reason", async () => {
      const hook = buildDenyPatternHook(["download_*"]);
      const result = await hook("download_file", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("download_*");
    });
  });

  it("returns allowed:true for empty pattern list", () => {
    const hook = buildDenyPatternHook([]);
    expect(hook("anything", {})).toMatchObject({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// Config-driven deny patterns (integration: hook + config)
// ---------------------------------------------------------------------------

describe("config-driven deny patterns", () => {
  it("deny patterns loaded from config block matching tools", async () => {
    const hook = buildDenyPatternHook(["shutdown", "transcribe_*"]);
    setPreToolHook(hook);

    expect((await invokePreToolHook("shutdown", {})).allowed).toBe(false);
    expect((await invokePreToolHook("transcribe_voice", {})).allowed).toBe(false);
    expect((await invokePreToolHook("send_text", {})).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logBlockedToolCall — stderr audit log
// ---------------------------------------------------------------------------

describe("logBlockedToolCall", () => {
  it("writes [hook:blocked] line to stderr with tool name and reason", () => {
    const { lines, spy } = captureStderr();
    logBlockedToolCall("shutdown", "not permitted");
    spy.mockRestore();
    expect(lines.some((l) => l.includes("[hook:blocked]"))).toBe(true);
    expect(lines.some((l) => l.includes("shutdown"))).toBe(true);
    expect(lines.some((l) => l.includes("not permitted"))).toBe(true);
  });

  it("includes the tool name and reason in a single log line", () => {
    const { lines, spy } = captureStderr();
    logBlockedToolCall("download_file", "audit policy");
    spy.mockRestore();
    const line = lines.find((l) => l.includes("[hook:blocked]"));
    expect(line).toBeDefined();
    expect(line).toContain("download_file");
    expect(line).toContain("audit policy");
  });
});
