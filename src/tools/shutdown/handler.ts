import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult } from "../../telegram.js";
import { elegantShutdown } from "../../shutdown.js";
import { pendingCount } from "../../message-store.js";
import { listSessions } from "../../session-manager.js";
import { getSessionQueue } from "../../session-queue.js";
import { getGovernorSid } from "../../routing-mode.js";

const DESCRIPTION =
  "Shuts down the MCP server process cleanly. Notifies all active sessions, " +
  "flushes pending queues, dumps the session log, then exits. " +
  "Call this after running `pnpm build` to pick up code changes. " +
  "When no non-governor participant sessions are active (i.e. you are the only " +
  "session), shutdown proceeds immediately regardless of pending messages. " +
  "When other participant sessions are active and there are pending messages, a " +
  "success result containing a `warning` field is returned (not a tool error) — " +
  "callers must handle both the warning form (`shutting_down: false, warning: " +
  "'PENDING_MESSAGES'`) and the shutdown form (`shutting_down: true`). " +
  "Drain pending messages first or pass `force: true` to shut down anyway.";

export function handleShutdown({ force }: { force?: boolean }) {
  // When no non-governor participant sessions are active, pending items can never be
  // processed — the governor is shutting down and no other sessions exist to drain them.
  // Shut down immediately without the pending-message safety check.
  //
  // This covers both the zero-sessions case and the governor-only (single-session) case.
  // In normal operation getGovernorSid() is non-zero whenever sessions are active.
  // When governorSid === 0 (no governor tracked), filter(s.sid !== 0) preserves all
  // sessions so the pending check still fires — safe conservative fallback.
  const activeSessions = listSessions();
  const governorSid = getGovernorSid();
  const participantCount = activeSessions.filter(s => s.sid !== governorSid).length;
  if (participantCount === 0) {
    const result = toResult({ shutting_down: true, pending_at_shutdown: pendingCount() });
    setImmediate(() => { void elegantShutdown("agent"); });
    return result;
  }

  // Sum pending across the global queue (unrouted messages) and all active
  // session queues (routed but not yet consumed by agents).
  const globalPending = pendingCount();
  const sessionPending = activeSessions
    .reduce((sum, s) => sum + (getSessionQueue(s.sid)?.pendingCount() ?? 0), 0);
  const pending = globalPending + sessionPending;

  // NOTE: Returns a success result with `warning` field (not a tool error) when
  // pending messages exist. Callers must check for `shutting_down: false` +
  // `warning: "PENDING_MESSAGES"` — this is distinct from a tool-level error.
  if (pending > 0 && !force) {
    return toResult({
      shutting_down: false,
      warning: "PENDING_MESSAGES",
      pending,
      message:
        `${pending} pending message(s) in queue — process them first ` +
        `or pass \`force: true\` to shut down anyway.`,
    });
  }

  // Send the response first so the caller gets confirmation before we exit.
  // pending_at_shutdown reports the count at decision time; with force=true these
  // messages are abandoned (not drained), so callers should not treat this as
  // a delivery confirmation.
  const result = toResult({ shutting_down: true, pending_at_shutdown: pending });
  setImmediate(() => { void elegantShutdown("agent"); });
  return result;
}

export function register(server: McpServer) {
  server.registerTool(
    "shutdown",
    {
      description: DESCRIPTION,
      inputSchema: {
        force: z
          .boolean()
          .optional()
          .describe(
            "Bypass the pending-message safety guard. Required when unprocessed " +
            "messages exist in the queue.",
          ),
      },
    },
    handleShutdown,
  );
}
