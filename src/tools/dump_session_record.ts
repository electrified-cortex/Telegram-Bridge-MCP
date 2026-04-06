import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toError, sendServiceMessage } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { rollLog } from "../local-log.js";

const DESCRIPTION =
  "Triggers a local log roll: the current session event log is finalized and " +
  "a new log file starts. Returns the filename of the archived log. " +
  "Log content is stored locally in data/logs/ — it is never sent to Telegram. " +
  "Use get_log to read the archived log content. " +
  "Prefer roll_log for new code — this tool is retained for backward compatibility.";

export function register(server: McpServer) {
  server.registerTool(
    "dump_session_record",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
      },
    },
    async ({ token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      try {
        const archivedFilename = rollLog();

        if (archivedFilename) {
          void sendServiceMessage(`📋 Log file created: \`${archivedFilename}\``).catch(() => {});
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ filename: archivedFilename, message: "Log rolled. Use get_log to read the file." }),
            }],
          };
        } else {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ filename: null, message: "No events in current log — nothing to roll." }),
            }],
          };
        }
      } catch (err) {
        return toError(err);
      }
    }
  );
}
