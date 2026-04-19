/**
 * Agent-approval module.
 *
 * Manages delegation state and the pending approval registry so that agents
 * can resolve `session_start` approval requests via the `approve_agent` tool.
 *
 * Lifecycle:
 *  1. `initAgentApprovalTool(server)` — called once from `createServer()`.
 *     Registers the tool and stores the handle. The tool is always callable;
 *     callers get BLOCKED error unless delegation is enabled.
 *  2. `setDelegationEnabled(true/false)` — toggled by the /approve panel.
 *  3. `session_start.ts` calls `registerPendingApproval` when waiting for
 *     an operator decision, and `clearPendingApproval` when the promise
 *     resolves (approval, denial, or timeout).
 */

import { randomBytes } from "node:crypto";
import type { RegisteredTool, McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerApproveAgent } from "./tools/approve_agent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalDecision = { approved: boolean; color?: string; forceColor?: boolean };

export interface PendingApproval {
  name: string;
  ticket: string;
  resolve: (d: ApprovalDecision) => void;
  registeredAt: number;
  colorHint?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _enabled = false;
let _tool: RegisteredTool | undefined;
let _server: McpServer | undefined;

/** Pending approvals keyed by one-time ticket (hex string). */
const _pending = new Map<string, PendingApproval>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true when agent delegation is currently enabled. */
export function isDelegationEnabled(): boolean {
  return _enabled;
}

/**
 * Enable or disable agent delegation.
 * Notifies connected MCP clients of the tool-list change.
 */
export function setDelegationEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (_server) {
    _server.sendToolListChanged();
  }
}

/**
 * Register a pending approval so an agent can resolve it via `approve_agent`.
 * `resolve` is the resolver from the `session_start` Promise constructor.
 * Returns the one-time ticket that must be passed to `approve_agent`.
 */
export function registerPendingApproval(
  name: string,
  resolve: (d: ApprovalDecision) => void,
  colorHint?: string,
): string {
  const ticket = randomBytes(16).toString("hex");
  _pending.set(ticket, { name, ticket, resolve, registeredAt: Date.now(), colorHint });
  return ticket;
}

/** Remove a pending approval entry (called after the promise resolves). */
export function clearPendingApproval(ticket: string): void {
  _pending.delete(ticket);
}

/** Look up a pending approval by ticket. Returns undefined if not found. */
export function getPendingApproval(ticket: string): PendingApproval | undefined {
  return _pending.get(ticket);
}

/**
 * Initialize the `approve_agent` tool on the server.
 * Must be called exactly once from `createServer()`.
 * The tool is always registered and callable — callers receive a BLOCKED error
 * unless delegation is turned on via `setDelegationEnabled(true)`.
 */
export function initAgentApprovalTool(server: McpServer): void {
  _server = server;
  _tool = registerApproveAgent(server);
}
