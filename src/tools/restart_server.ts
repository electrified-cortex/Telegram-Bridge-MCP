import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";
import { clearCommandsOnShutdown } from "../shutdown.js";

const DESCRIPTION =
  "Restarts the MCP server process. VS Code detects the exit and relaunches it " +
  "automatically, picking up any freshly built code. Call this after running " +
  "`pnpm build` to apply changes without leaving VS Code.";

export function register(server: McpServer) {
  server.registerTool(
    "restart_server",
    {
      description: DESCRIPTION,
    },
    async () => {
      // Send the response first so the caller gets confirmation before we exit
      const result = toResult({ restarting: true });
      setImmediate(() => void clearCommandsOnShutdown().finally(() => process.exit(0)));
      return result;
    }
  );
}
