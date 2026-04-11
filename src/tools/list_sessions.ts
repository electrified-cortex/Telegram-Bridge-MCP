import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError } from "../telegram.js";
import { listSessions, getActiveSession } from "../session-manager.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requireAuth } from "../session-gate.js";

const DESCRIPTION =
  "List active sessions. " +
  "Requires a valid token. " +
  "Returns full session details (ID, name, color, createdAt) and the active SID.";

export function handleListSessions({ token }: { token: number }) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const sessions = listSessions();
  const active = getActiveSession();
  return toResult({ sessions, active_sid: active });
}

export function register(server: McpServer) {
  server.registerTool(
    "list_sessions",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA.describe(
          "Session token from session_start (sid * 1_000_000 + pin). Required.",
        ),
      },
    },
    handleListSessions,
  );
}
