import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock for the approve_agent module so vi.mock can reference it.
// initAgentApprovalTool calls register(server) from approve_agent.ts and
// stores the returned RegisteredTool. We mock that module to return a
// controllable stub so we can verify enable/disable calls.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  mockTool: {
    enable: vi.fn(),
    disable: vi.fn(),
  } as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").RegisteredTool,
  registerApproveAgent: vi.fn(),
}));

vi.mock("./tools/approve_agent.js", () => ({
  register: (...args: unknown[]) => {
    mocks.registerApproveAgent(...args);
    return mocks.mockTool;
  },
}));

import {
  isDelegationEnabled,
  setDelegationEnabled,
  registerPendingApproval,
  getPendingApproval,
  clearPendingApproval,
  initAgentApprovalTool,
} from "./agent-approval.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Minimal McpServer stub for testing initAgentApprovalTool
function createMockMcpServer(): McpServer & { sendToolListChanged: ReturnType<typeof vi.fn> } {
  return {
    sendToolListChanged: vi.fn(),
  } as unknown as McpServer & { sendToolListChanged: ReturnType<typeof vi.fn> };
}

describe("agent-approval module", () => {
  beforeEach(() => {
    // Reset module state first so any side-effect calls (e.g. _tool.disable())
    // happen before we clear mock call counts.
    setDelegationEnabled(false);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setDelegationEnabled(false);
  });

  describe("isDelegationEnabled", () => {
    it("returns false after setDelegationEnabled(false)", () => {
      setDelegationEnabled(false);
      expect(isDelegationEnabled()).toBe(false);
    });

    it("returns true after setDelegationEnabled(true)", () => {
      setDelegationEnabled(true);
      expect(isDelegationEnabled()).toBe(true);
    });

    it("returns false after toggling back off", () => {
      setDelegationEnabled(true);
      setDelegationEnabled(false);
      expect(isDelegationEnabled()).toBe(false);
    });
  });

  describe("setDelegationEnabled side-effects", () => {
    it("calls _tool.enable() when enabled and tool is initialized", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      vi.clearAllMocks();

      setDelegationEnabled(true);

      expect(mocks.mockTool.enable).toHaveBeenCalledOnce();
    });

    it("calls _tool.disable() when disabled and tool is initialized", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      setDelegationEnabled(true);
      vi.clearAllMocks();

      setDelegationEnabled(false);

      expect(mocks.mockTool.disable).toHaveBeenCalledOnce();
    });

    it("calls server.sendToolListChanged() when enabled", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      vi.clearAllMocks();

      setDelegationEnabled(true);

      expect(server.sendToolListChanged).toHaveBeenCalledOnce();
    });

    it("calls server.sendToolListChanged() when disabled", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      setDelegationEnabled(true);
      vi.clearAllMocks();

      setDelegationEnabled(false);

      expect(server.sendToolListChanged).toHaveBeenCalledOnce();
    });
  });

  describe("initAgentApprovalTool", () => {
    it("calls register(server) from approve_agent module", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      expect(mocks.registerApproveAgent).toHaveBeenCalledWith(server);
    });

    it("disables the tool immediately after registration", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      expect(mocks.mockTool.disable).toHaveBeenCalledOnce();
    });
  });

  describe("pending approval registry", () => {
    it("getPendingApproval returns undefined for unknown name", () => {
      expect(getPendingApproval("nobody")).toBeUndefined();
    });

    it("registerPendingApproval stores a pending entry retrievable by name", () => {
      const resolve = vi.fn();
      registerPendingApproval("Worker 1", resolve);

      const pending = getPendingApproval("Worker 1");
      expect(pending).toBeDefined();
      expect(pending!.name).toBe("Worker 1");
      expect(pending!.resolve).toBe(resolve);

      clearPendingApproval("Worker 1");
    });

    it("registeredAt is set to approximately now", () => {
      const before = Date.now();
      registerPendingApproval("Timer Test", vi.fn());
      const after = Date.now();

      const pending = getPendingApproval("Timer Test");
      expect(pending!.registeredAt).toBeGreaterThanOrEqual(before);
      expect(pending!.registeredAt).toBeLessThanOrEqual(after);

      clearPendingApproval("Timer Test");
    });

    it("clearPendingApproval removes the entry", () => {
      registerPendingApproval("Worker 2", vi.fn());
      clearPendingApproval("Worker 2");
      expect(getPendingApproval("Worker 2")).toBeUndefined();
    });

    it("clearPendingApproval is a no-op for unknown names", () => {
      expect(() => { clearPendingApproval("ghost"); }).not.toThrow();
    });

    it("registrations are keyed by name — different names are independent", () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      registerPendingApproval("Alpha", r1);
      registerPendingApproval("Beta", r2);

      expect(getPendingApproval("Alpha")!.resolve).toBe(r1);
      expect(getPendingApproval("Beta")!.resolve).toBe(r2);

      clearPendingApproval("Alpha");
      expect(getPendingApproval("Alpha")).toBeUndefined();
      expect(getPendingApproval("Beta")).toBeDefined();

      clearPendingApproval("Beta");
    });

    it("re-registering the same name overwrites the previous entry", () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      registerPendingApproval("Dup", r1);
      registerPendingApproval("Dup", r2);

      expect(getPendingApproval("Dup")!.resolve).toBe(r2);

      clearPendingApproval("Dup");
    });
  });
});
