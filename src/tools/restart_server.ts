import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";

/**
 * Gracefully exits the MCP server process.
 *
 * VS Code monitors stdio MCP server processes and automatically restarts them
 * when they exit, so calling this tool causes an immediate clean restart —
 * no user action required.
 *
 * Use this after `pnpm build` to pick up code changes without leaving VS Code.
 */
export function register(server: McpServer) {
  server.tool(
    "restart_server",
    "Restarts the MCP server process. VS Code detects the exit and relaunches it automatically, picking up any freshly built code. Call this after running `pnpm build` to apply changes without leaving VS Code.",
    {},
    async () => {
      // Send the response first so the caller gets confirmation before we exit
      const result = toResult({ restarting: true });
      setImmediate(() => process.exit(0));
      return result;
    }
  );
}
