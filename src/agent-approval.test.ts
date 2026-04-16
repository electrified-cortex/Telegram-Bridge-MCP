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
    it("does NOT call _tool.enable() when enabled (tool always visible)", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      vi.clearAllMocks();

      setDelegationEnabled(true);

      expect(mocks.mockTool.enable).not.toHaveBeenCalled();
    });

    it("does NOT call _tool.disable() when disabled (tool always visible)", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      setDelegationEnabled(true);
      vi.clearAllMocks();

      setDelegationEnabled(false);

      expect(mocks.mockTool.disable).not.toHaveBeenCalled();
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

    it("does NOT disable the tool after registration (tool is always visible)", () => {
      const server = createMockMcpServer();
      initAgentApprovalTool(server);
      expect(mocks.mockTool.disable).not.toHaveBeenCalled();
    });
  });

  describe("pending approval registry", () => {
    it("getPendingApproval returns undefined for unknown ticket", () => {
      expect(getPendingApproval("notavalidticket")).toBeUndefined();
    });

    it("registerPendingApproval stores a pending entry retrievable by returned ticket", () => {
      const resolve = vi.fn();
      const ticket = registerPendingApproval("Worker 1", resolve);

      expect(typeof ticket).toBe("string");
      expect(ticket.length).toBeGreaterThan(0);

      const pending = getPendingApproval(ticket);
      expect(pending).toBeDefined();
      expect(pending!.name).toBe("Worker 1");
      expect(pending!.ticket).toBe(ticket);
      expect(pending!.resolve).toBe(resolve);

      clearPendingApproval(ticket);
    });

    it("registeredAt is set to approximately now", () => {
      const before = Date.now();
      const ticket = registerPendingApproval("Timer Test", vi.fn());
      const after = Date.now();

      const pending = getPendingApproval(ticket);
      expect(pending!.registeredAt).toBeGreaterThanOrEqual(before);
      expect(pending!.registeredAt).toBeLessThanOrEqual(after);

      clearPendingApproval(ticket);
    });

    it("clearPendingApproval removes the entry", () => {
      const ticket = registerPendingApproval("Worker 2", vi.fn());
      clearPendingApproval(ticket);
      expect(getPendingApproval(ticket)).toBeUndefined();
    });

    it("clearPendingApproval is a no-op for unknown tickets", () => {
      expect(() => { clearPendingApproval("ghost"); }).not.toThrow();
    });

    it("registrations are keyed by ticket — different registrations are independent", () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      const t1 = registerPendingApproval("Alpha", r1);
      const t2 = registerPendingApproval("Beta", r2);

      expect(getPendingApproval(t1)!.resolve).toBe(r1);
      expect(getPendingApproval(t2)!.resolve).toBe(r2);

      clearPendingApproval(t1);
      expect(getPendingApproval(t1)).toBeUndefined();
      expect(getPendingApproval(t2)).toBeDefined();

      clearPendingApproval(t2);
    });

    it("each registration for the same name produces a unique ticket", () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      const t1 = registerPendingApproval("Dup", r1);
      const t2 = registerPendingApproval("Dup", r2);

      expect(t1).not.toBe(t2);
      expect(getPendingApproval(t1)!.resolve).toBe(r1);
      expect(getPendingApproval(t2)!.resolve).toBe(r2);

      clearPendingApproval(t1);
      clearPendingApproval(t2);
    });
  });
});
