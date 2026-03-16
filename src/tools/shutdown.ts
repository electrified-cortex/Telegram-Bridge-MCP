import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, sendServiceMessage } from "../telegram.js";
import { clearCommandsOnShutdown } from "../shutdown.js";
import { stopPoller } from "../poller.js";

const DESCRIPTION =
  "Shuts down the MCP server process cleanly. The MCP host " +
  "will detect the exit and can relaunch it automatically. Reconnecting to " +
  "the server after shutdown starts it back up. Call this after running " +
  "`pnpm build` to pick up code changes.";

export function register(server: McpServer) {
  server.registerTool(
    "shutdown",
    {
      description: DESCRIPTION,
    },
    () => {
      // Send the response first so the caller gets confirmation before we exit
      const result = toResult({ shutting_down: true });
      setImmediate(() => {
        stopPoller();
        const notifyShutdown = Promise.race([
          sendServiceMessage("⛔️ Shutting down…").catch((e: unknown) => { process.stderr.write(`[shutdown] sendServiceMessage error: ${String(e)}\n`); }),
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
        void notifyShutdown.finally(() => clearCommandsOnShutdown().finally(() => process.exit(0)));
      });
      return result;
    }
  );
}
