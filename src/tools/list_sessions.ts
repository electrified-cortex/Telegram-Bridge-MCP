import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";
import { listSessions, getActiveSession } from "../session-manager.js";

const DESCRIPTION =
  "List all active sessions. Returns each session's ID, name, " +
  "and creation time. The currently active session (if any) is " +
  "indicated. Does not require authentication.";

export function register(server: McpServer) {
  server.registerTool(
    "list_sessions",
    { description: DESCRIPTION },
    () => {
      const sessions = listSessions();
      const active = getActiveSession();
      return toResult({ sessions, active_sid: active });
    },
  );
}
