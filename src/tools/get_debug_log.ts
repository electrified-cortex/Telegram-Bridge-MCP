import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";
import { getDebugLog, debugLogSize, isDebugEnabled, setDebugEnabled, type DebugCategory } from "../debug-log.js";

const CATEGORIES: DebugCategory[] = ["session", "route", "queue", "cascade", "dm", "animation", "tool"];

const DESCRIPTION =
  "Read the server's debug trace log. Returns recent entries from the in-memory " +
  "ring buffer (max 2 000). Each entry has an auto-incrementing `id` — use " +
  "`since` to fetch only entries newer than a known id (cursor-based pagination). " +
  "Filter by category, limit count, or toggle debug mode. " +
  "Use this to inspect routing decisions, session lifecycle events, queue operations, " +
  "and DM deliveries during a live session.";

export function register(server: McpServer) {
  server.registerTool(
    "get_debug_log",
    {
      description: DESCRIPTION,
      inputSchema: {
        count: z.number().int().min(1).max(500).optional()
          .describe("Max entries to return (default 50, most recent first)"),
        category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional()
          .describe("Filter to a single category"),
        since: z.number().int().min(0).optional()
          .describe("Only return entries with id > since (cursor-based pagination)"),
        enable: z.boolean().optional()
          .describe("Set to true/false to toggle debug logging on/off"),
      },
    },
    ({ count, category, since, enable }) => {
      if (enable !== undefined) setDebugEnabled(enable);

      const entries = getDebugLog(count ?? 50, category as DebugCategory | undefined, since);
      return toResult({
        enabled: isDebugEnabled(),
        total: debugLogSize(),
        returned: entries.length,
        entries,
      });
    },
  );
}
