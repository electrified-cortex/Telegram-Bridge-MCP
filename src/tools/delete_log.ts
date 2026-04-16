import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { deleteLog } from "../local-log.js";
import { clearTraceLog } from "../trace-log.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Delete an archived local log file by filename. " +
  "Use this after an agent has captured the log content via get_log. " +
  "This is the acknowledgment ceremony after log retrieval. " +
  "Pass filename: 'trace' to clear the in-memory behavioral audit trace buffer " +
  "(use after action(type: 'log/trace') to retrieve and then discard).";

export function handleDeleteLog({ filename, token }: { filename: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  // Special case: 'trace' clears the in-memory trace buffer instead of a file.
  if (filename === "trace") {
    clearTraceLog();
    return toResult({ deleted: true, filename: "trace", note: "In-memory trace buffer cleared." });
  }

  try {
    deleteLog(filename);
    return toResult({ deleted: true, filename });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "delete_log",
    {
      description: DESCRIPTION,
      inputSchema: {
        filename: z
          .string()
          .describe("Log filename to delete (e.g. '2025-04-05T143022.json')."),
        token: TOKEN_SCHEMA,
      },
    },
    handleDeleteLog,
  );
}
