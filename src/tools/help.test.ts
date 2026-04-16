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
      if (p.includes("docs") && p.includes("help") && p.includes("shutdown.md")) return "Graceful Shutdown — shutdown signal triggers clean exit.";
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
    expect(content).toContain("Tool Index");
  });

  it("help(topic: 'guide') returns the communication guide content", async () => {
    const result = await call({ topic: "guide" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("Agent Communication Guide");
    expect(content).toContain(MOCK_GUIDE);
  });

  it("help(topic: 'compression') returns the compression cheat sheet", async () => {
    const result = await call({ topic: "compression" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("Compression Cheat Sheet");
    expect(content).not.toContain("Save to session memory");
    expect(content).toContain("Surface Map");
  });

  it("help(topic: 'notify') returns the notify tool description", async () => {
    const result = await call({ topic: "notify" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("notify");
    expect(content).toContain("notification");
  });

  it("help(topic: 'start') returns profile load, dequeue loop, and send basics", async () => {
    const result = await call({ topic: "start" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("profile/load");
    expect(content).toContain("dequeue()");
    expect(content).toContain("5 minutes");
    expect(content).toContain("help('guide')");
  });

  it("help(topic: 'startup') is aliased to 'start'", async () => {
    const result = await call({ topic: "startup" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("profile/load");
    expect(content).toContain("dequeue()");
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
    expect(parsed.message).toContain("Unknown topic: 'unknown_tool'");
    expect(parsed.message).toContain("help()");
  });

  it("returns rich dequeue guide", async () => {
    const result = await call({ topic: "dequeue" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("drain");
  });

  it("returns rich shutdown guide", async () => {
    const result = await call({ topic: "shutdown" });
    expect(isError(result)).toBe(false);
    const { content } = parseResult<{ content: string }>(result);
    expect(content).toContain("shutdown");
  });

  describe("topic: 'identity'", () => {
    const VALID_TOKEN = 1123456; // sid=1, pin=123456

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
