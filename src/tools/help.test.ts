import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const MOCK_GUIDE = "# Behavior Guide\n\nThis is the mock guide content.";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  validateSession: vi.fn(() => true),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks };
});

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("module", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  const mod = Object.assign(Object.create(null) as object, actual);
  return Object.assign(mod, {
    createRequire: () => (path: string) => {
      if (path.endsWith("package.json")) return { version: "0.0.0-test" };
      if (path.endsWith("build-info.json"))
        return { BUILD_COMMIT: "t3stc0mm", BUILD_TIME: "2025-01-01T00:00:00.000Z" };
      throw new Error(`Unexpected require: ${path}`);
    },
  });
});

vi.mock("fs", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    existsSync: (path: unknown) => {
      const p = String(path);
      if (p.includes("docs") && p.includes("help")) return true;
      return (actual.existsSync as (...a: unknown[]) => unknown)(path);
    },
    readFileSync: (path: unknown, _encoding?: unknown) => {
      const p = String(path);
      if (p.includes("docs") && p.includes("help") && p.includes("guide.md")) return MOCK_GUIDE;
      if (p.includes("docs") && p.includes("help") && p.includes("dequeue.md")) return "Dequeue Loop — drain before acting. pending > 0 → call dequeue again.";
      if (p.includes("docs") && p.includes("help") && p.includes("shutdown.md"))
        return [
          "Graceful Shutdown — how to exit the Telegram bridge cleanly.",
          "",
          "Only the **governor** (Curator) may call action(type: \"shutdown\").",
          "Participants call action(type: \"session/close\") on their own session only.",
          "",
          "## Participant Shutdown",
          "",
          "When the governor DMs you \"Shutting down — close your session\" (or you decide to close early):",
          "",
          "1. Wipe your session token. Overwrite `memory/telegram/session.token` with empty content.",
          "   Prevents stale-token resume on next launch.",
          "2. action(type: \"session/close\") — closes YOUR session only. Never pass target_sid.",
          "3. Stop. No more tool calls after session/close.",
          "4. Optional: write a handoff doc and commit. Your agent process is still alive after",
          "   session/close; you can still write files and commit.",
          "   Token is already wiped so you are no longer connected to the bridge.",
          "",
          "## Governor Shutdown",
          "",
          "Only Curator executes this flow. action(type: \"shutdown\") is the governor's analogue of",
          "session/close — it tears down the whole bridge, including the governor's own session.",
          "Do NOT call session/close on yourself before shutdown.",
          "",
          "1. Drain queue. dequeue(max_wait: 0) until empty.",
          "2. Generate compaction report (failure-tolerant). Run `node scripts/event-report.mjs --format text`",
          "   from repo root and save stdout to `logs/session/YYYYMM/DD/HHmmss/compaction-report.md`.",
          "   Pass `--window <session-hours>` if the session ran longer than 24 h.",
          "   If the script is absent, the event log is missing, or the run fails, note it and skip",
          "   — this step MUST NOT block shutdown.",
          "3. Wipe session memory file. Overwrite `memory/telegram/session.token` with empty content",
          "   before calling shutdown.",
          "4. DM each remaining session: \"Shutting down — close your session.\"",
          "5. Wait for session_closed events from each participant.",
          "6. Write session log: logs/session/YYYYMM/DD/HHmmss/summary.md.",
          "   If the compaction report was generated, note it (e.g., `Compaction report: see compaction-report.md`).",
          "7. Commit: git add session log + compaction report (if generated) + any pending changes.",
          "8. Acknowledge operator (brief voice message).",
          "9. action(type: \"shutdown\") — triggers MCP bridge graceful shutdown.",
          "   This is the last action you take; it closes your session and shuts down the bridge.",
          "   Do NOT call session/close on yourself before this.",
          "",
          "Invariant: wipe token BEFORE calling shutdown.",
          "Note: handoff doc is optional. It may be written before or after shutdown — your process",
          "continues running. Curator's habit of writing it before shutdown is a preference, not a TMCP requirement.",
          "",
          "If a participant fails to close cleanly, the governor may need",
          "action(type: \"session/close\", force: true, target_sid: N) before invoking shutdown.",
        ].join("\n");
      if (p.includes("docs") && p.includes("help") && p.includes("activity") && p.includes("file.md"))
        return "# activity/file — Wake-Nudge Integration Guide\n\noptional augment. dequeue is primary.\n\nContent stays empty/stable — mtime is the signal.\n\nwatcher patterns: bash poll, PowerShell FileSystemWatcher, inotifywait.\n\nSee help('compaction-recovery') for the full recovery sequence.";
      if (p.includes("docs") && p.includes("help") && p.includes("compaction-recovery.md"))
        return "# compaction-recovery — Activity File Monitor Recovery\n\nMonitors do not survive compaction. Use activity/file/get to retrieve the existing path, then re-arm a fresh monitor. Do not call activity/file/create.";
      // Fall through to actual for anything else
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, _encoding);
    },
  };
});

import { register } from "./help.js";

describe("help tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("help");
  });

  it("help() with no topic returns an overview containing tool names", async () => {
    const result = await call({});
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("notify");
    expect(content).toContain("session_start");
    expect(content).toContain("dequeue");
    expect(content).toContain("help");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("help(topic: 'guide') returns the communication guide content", async () => {
    const result = await call({ topic: "guide" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain(MOCK_GUIDE);
  });

  it("help(topic: 'compression') returns the compression cheat sheet", async () => {
    const result = await call({ topic: "compression" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("help(topic: 'notify') returns the notify tool description", async () => {
    const result = await call({ topic: "notify" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("notify");
    expect(typeof content).toBe("string");
  });

  it("help(topic: 'start') returns profile load, dequeue loop, send basics, and quick reference", async () => {
    const result = await call({ topic: "start" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("profile/load");
    expect(content).toContain("dequeue(token)");
    expect(content).toContain("help('guide')");
    expect(content).toContain("help('send')");
    expect(content).toContain("help('action')");
  });

  it("help(topic: 'startup') is aliased to 'start'", async () => {
    const result = await call({ topic: "startup" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("profile/load");
    expect(content).toContain("dequeue(token)");
  });

  it("help(topic: 'quick_start') is aliased to 'start'", async () => {
    const result = await call({ topic: "quick_start" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("dequeue");
    expect(content).toContain("send");
  });

  it("help(topic: 'unknown_tool') returns isError: true with UNKNOWN code", async () => {
    const result = await call({ topic: "unknown_tool" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNKNOWN");
    const parsed = parseResult<{ message: string }>(result);
    expect(typeof parsed.message).toBe("string");
    expect(parsed.message.length).toBeGreaterThan(0);
  });

  it("returns rich dequeue guide", async () => {
    const result = await call({ topic: "dequeue" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("returns rich shutdown guide", async () => {
    const result = await call({ topic: "shutdown" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain('action(type: "session/close")');
    expect(content).toContain('action(type: "shutdown")');
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);

    // Finding 2: wipe step must appear before the shutdown action call (scoped to Governor section)
    const governorSectionForOrder = content.slice(content.indexOf("## Governor Shutdown"));
    const wipeIdx = governorSectionForOrder.indexOf("memory/telegram/session.token");
    const shutdownActionIdx = governorSectionForOrder.lastIndexOf('action(type: "shutdown")');
    expect(wipeIdx).toBeGreaterThan(-1);
    expect(shutdownActionIdx).toBeGreaterThan(-1);
    expect(wipeIdx).toBeLessThan(shutdownActionIdx);

    // Finding 3: governor section must NOT instruct agents to call session/close
    const governorSection = content.slice(content.indexOf("## Governor Shutdown"));
    expect(governorSection).not.toContain("action(type: \"session/close\")");
  });

  it("help(topic: 'activity/file') returns the activity-file integration guide", async () => {
    const result = await call({ topic: "activity/file" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("dequeue");
    expect(content).toContain("watcher");
    expect(content).toContain("mtime");
    expect(content).toContain("compaction-recovery");
  });

  it("help(topic: 'compaction-recovery') returns the compaction recovery guide", async () => {
    const result = await call({ topic: "compaction-recovery" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("activity/file/get");
    expect(content).toContain("monitor");
  });

  describe("topic: 'identity'", () => {
    const VALID_TOKEN = 1123456; // sid=1, suffix=123456

    it("returns bot info + mcp metadata when token is valid", async () => {
      const bot = { id: 1, is_bot: true, first_name: "Bot", username: "test_bot" };
      mocks.getMe.mockResolvedValue(bot);
      const result = await call({ topic: "identity", token: VALID_TOKEN });
      expect(isError(result)).toBe(false);
      const parsed = parseResult(result);
      expect(parsed.mcp_version).toBe("0.0.0-test");
      expect(parsed.mcp_commit).toBe("t3stc0mm");
      expect(parsed.mcp_build_time).toBe("2025-01-01T00:00:00.000Z");
      expect(parsed.id).toBe(1);
      expect(parsed.is_bot).toBe(true);
      expect(parsed.first_name).toBe("Bot");
      expect(parsed.username).toBe("test_bot");
    });

    it("returns AUTH_FAILED error when token is invalid", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ topic: "identity", token: VALID_TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("returns SID_REQUIRED error when token is omitted", async () => {
      const result = await call({ topic: "identity" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });
  });
});
