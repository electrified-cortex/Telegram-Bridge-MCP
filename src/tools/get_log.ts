import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toError } from "../telegram.js";
import { getLog, listLogs, getCurrentLogFilename } from "../local-log.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Read a local log file by filename and return its content via MCP tool response. " +
  "Log content never transits Telegram. " +
  "Omit filename to list available log files (includes current_log for the active session log), or use list_logs to discover them. " +
  "Provide filename to read a specific log.";

export function handleGetLog({ filename, token }: { filename?: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  // List mode
  if (!filename) {
    const files = listLogs();
    const current = getCurrentLogFilename();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          current_log: current,
          log_files: files,
          count: files.length,
        }, null, 2),
      }],
    };
  }

  // Read mode
  try {
    const content = getLog(filename);
    return {
      content: [{
        type: "text" as const,
        text: content,
      }],
    };
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "get_log",
    {
      description: DESCRIPTION,
      inputSchema: {
        filename: z
          .string()
          .optional()
          .describe(
            "Log filename to read (e.g. '2025-04-05T143022.json'). " +
            "Omit to list available log files instead."
          ),
        token: TOKEN_SCHEMA,
      },
    },
    handleGetLog,
  );
}
