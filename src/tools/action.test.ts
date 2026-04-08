import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// action tool handler tests
// (action-registry unit tests live in src/action-registry.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  registerAction: vi.fn(),
  resolveAction: vi.fn<() => undefined | { handler: ReturnType<typeof vi.fn>; meta: { governor?: boolean } }>(),
  listCategories: vi.fn<() => string[]>(),
  listSubPaths: vi.fn<() => string[]>(),
  clearRegistry: vi.fn(),
  requireAuth: vi.fn<() => number | { code: string; message: string }>(),
  getGovernorSid: vi.fn<() => number>(),
  // Phase 1 handler stubs — just need to exist for the import
  handleSetVoice: vi.fn(),
  handleListSessions: vi.fn(),
  handleCloseSession: vi.fn(),
  handleSessionStart: vi.fn(),
  handleRenameSession: vi.fn(),
  handleEditMessage: vi.fn(),
}));

vi.mock("../action-registry.js", () => ({
  registerAction: mocks.registerAction,
  resolveAction: mocks.resolveAction,
  listCategories: mocks.listCategories,
  listSubPaths: mocks.listSubPaths,
  clearRegistry: mocks.clearRegistry,
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

vi.mock("./set_voice.js", () => ({
  handleSetVoice: mocks.handleSetVoice,
  register: vi.fn(),
}));

vi.mock("./list_sessions.js", () => ({
  handleListSessions: mocks.handleListSessions,
  register: vi.fn(),
}));

vi.mock("./close_session.js", () => ({
  handleCloseSession: mocks.handleCloseSession,
  register: vi.fn(),
}));

vi.mock("./session_start.js", () => ({
  handleSessionStart: mocks.handleSessionStart,
  register: vi.fn(),
}));

vi.mock("./rename_session.js", () => ({
  handleRenameSession: mocks.handleRenameSession,
  register: vi.fn(),
}));

vi.mock("./edit_message.js", () => ({
  handleEditMessage: mocks.handleEditMessage,
  register: vi.fn(),
}));

import { register } from "./action.js";

const VALID_TOKEN = 1_123_456; // sid=1, pin=123456

describe("action tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue(1);
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listCategories.mockReturnValue(["config", "message", "session"]);
    mocks.listSubPaths.mockReturnValue([]);
    mocks.resolveAction.mockReturnValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("action");
  });

  // ── Discovery tier 1: no type ───────────────────────────────────────────

  describe("tier 1: no type → category list", () => {
    it("returns categories when type is omitted", async () => {
      mocks.listCategories.mockReturnValue(["config", "session"]);
      const result = await call({});
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.categories).toEqual(["config", "session"]);
      expect(typeof data.hint).toBe("string");
    });

    it("includes a hint in the response", async () => {
      mocks.listCategories.mockReturnValue([]);
      const result = await call({});
      const data = parseResult(result);
      expect(data.hint).toContain("action");
    });
  });

  // ── Discovery tier 2: category only ────────────────────────────────────

  describe("tier 2: category only → sub-path list", () => {
    it("returns sub-paths when type is a category prefix", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue(["session/close", "session/list", "session/start"]);
      const result = await call({ type: "session" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.category).toBe("session");
      expect(data.paths).toEqual(["session/close", "session/list", "session/start"]);
    });

    it("includes a usage hint in the sub-path response", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue(["session/list"]);
      const result = await call({ type: "session" });
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
    });
  });

  // ── Discovery tier 3: full path dispatch ────────────────────────────────

  describe("tier 3: full path → dispatch", () => {
    it("dispatches to handler when type matches a registered path", async () => {
      const fakeHandler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "session/list", token: VALID_TOKEN });
      expect(fakeHandler).toHaveBeenCalledOnce();
      expect(isError(result)).toBe(false);
    });

    it("forwards all args to the handler", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      await call({ type: "config/voice", token: VALID_TOKEN, voice: "alloy", speed: 1.2 });
      const calledArgs = fakeHandler.mock.calls[0][0];
      expect(calledArgs.voice).toBe("alloy");
      expect(calledArgs.speed).toBe(1.2);
      expect(calledArgs.token).toBe(VALID_TOKEN);
    });

    it("passes async handler results through correctly", async () => {
      const expected = { content: [{ type: "text", text: JSON.stringify({ sessions: [] }) }] };
      const fakeHandler = vi.fn().mockResolvedValue(expected);
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "session/list", token: VALID_TOKEN });
      expect(result).toEqual(expected);
    });
  });

  // ── Unknown path ─────────────────────────────────────────────────────────

  describe("unknown path", () => {
    it("returns UNKNOWN_ACTION error for an unregistered path", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue([]);
      const result = await call({ type: "nonexistent/path" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_ACTION");
    });

    it("includes the unknown path in the error message", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue([]);
      const result = await call({ type: "totally/unknown" });
      expect(isError(result)).toBe(true);
      const parsed = JSON.parse((result as { isError: boolean; content: Array<{ text: string }> }).content[0].text) as { message: string };
      expect(parsed.message).toContain("totally/unknown");
    });
  });

  // ── Auth gating ───────────────────────────────────────────────────────────

  describe("governor gating", () => {
    it("allows governor-only path when caller is the governor", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(1);
      mocks.getGovernorSid.mockReturnValue(1);
      const result = await call({ type: "log/get", token: VALID_TOKEN });
      expect(isError(result)).toBe(false);
      expect(fakeHandler).toHaveBeenCalledOnce();
    });

    it("rejects governor-only path when caller is not the governor", async () => {
      const fakeHandler = vi.fn();
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(2); // SID 2 is not governor
      mocks.getGovernorSid.mockReturnValue(1); // SID 1 is governor
      const result = await call({ type: "log/get", token: 2_123_456 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("NOT_GOVERNOR");
      expect(fakeHandler).not.toHaveBeenCalled();
    });

    it("returns auth error when token is invalid for governor path", async () => {
      mocks.resolveAction.mockReturnValue({ handler: vi.fn(), meta: { governor: true } });
      mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "Invalid token." });
      const result = await call({ type: "log/get", token: 999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });
  });

  // ── setupActionRegistry wires Phase 1 paths ───────────────────────────────

  describe("registry wiring", () => {
    it("calls registerAction for all Phase 1 paths on setup", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(registeredPaths).toContain("session/start");
      expect(registeredPaths).toContain("session/close");
      expect(registeredPaths).toContain("session/list");
      expect(registeredPaths).toContain("session/rename");
      expect(registeredPaths).toContain("config/voice");
      expect(registeredPaths).toContain("message/edit");
    });
  });
});
