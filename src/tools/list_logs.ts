import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toError } from "../telegram.js";
import { listLogs, getCurrentLogFilename, isLoggingEnabled } from "../local-log.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "List all archived local log files and the current active log. " +
  "Returns filenames sorted oldest-first. Log content never transits Telegram — " +
  "use get_log to read a specific file.";

export function handleListLogs({ token }: { token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const archived = listLogs();
  const current = getCurrentLogFilename();
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        logging_enabled: isLoggingEnabled(),
        current_log: current,
        archived_logs: archived,
        archived_count: archived.length,
      }, null, 2),
    }],
  };
}

export function register(server: McpServer) {
  server.registerTool(
    "list_logs",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
      },
    },
    handleListLogs,
  );
}
