import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat, sendServiceMessage } from "../telegram.js";
import { rollLog } from "../local-log.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Roll the current local session log: closes the current log file, archives it, " +
  "and starts a new one immediately. " +
  "Emits a service notification to chat with the archived filename. " +
  "Log content never transits Telegram — use get_log to read a log file. " +
  "No session ID required — any authenticated caller can trigger a roll.";

export function register(server: McpServer) {
  server.registerTool(
    "roll_log",
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
          // Notify chat with filename only — no content
          void sendServiceMessage(`📋 Log file created: \`${archivedFilename}\``).catch(() => {});
          return toResult({
            rolled: true,
            filename: archivedFilename,
          });
        } else {
          return toResult({
            rolled: false,
            message: "No events in current log — nothing to roll.",
          });
        }
      } catch (err) {
        return toError(err);
      }
    }
  );
}
