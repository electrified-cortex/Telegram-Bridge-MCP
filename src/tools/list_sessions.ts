import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError } from "../telegram.js";
import { listSessions, getActiveSession } from "../session-manager.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requireAuth } from "../session-gate.js";

const DESCRIPTION =
  "List active sessions. " +
  "Token is optional. " +
  "Without a token: returns only the list of active SIDs — no auth required. " +
  "Use this as a probe after a bridge restart to check if your SID survived. " +
  "With a valid token: returns full session details (ID, name, color, createdAt) and the active SID.";

export function handleListSessions({ token }: { token?: number }) {
  if (token === undefined) {
    // Unauthenticated probe — SIDs only, no details
    return toResult({ sids: listSessions().map(s => s.sid) });
  }

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
        token: TOKEN_SCHEMA.optional().describe(
          "Session token (sid * 1_000_000 + suffix). " +
          "Omit for an unauthenticated SID probe (returns { sids: [...] }). " +
          "Provide to get full session details (requires a valid token).",
        ),
      },
    },
    handleListSessions,
  );
}
