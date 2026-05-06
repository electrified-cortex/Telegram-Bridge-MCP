import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError, sendServiceMessage } from "../../telegram.js";
import { rollLog, flushCurrentLog } from "../../local-log.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";

const DESCRIPTION =
  "Roll the current local session log: closes the current log file, archives it, " +
  "and starts a new one immediately. " +
  "Emits a service notification to chat with the archived filename. " +
  "Log content never transits Telegram — use get_log to read a log file. " +
  "No separate session selection is required — any caller with a valid authenticated token can trigger a roll.";

export async function handleRollLog({ token }: { token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  try {
    await flushCurrentLog();
    const archivedFilename = rollLog();

    if (archivedFilename) {
      // Notify chat with filename only — no content
      void sendServiceMessage(`📋 Log file created: \`${archivedFilename}\``).catch(() => {});
      return toResult({
        filename: archivedFilename,
      });
    } else {
      return toResult({
        message: "No events in current log — nothing to roll.",
      });
    }
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "roll_log",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
      },
    },
    handleRollLog,
  );
}
