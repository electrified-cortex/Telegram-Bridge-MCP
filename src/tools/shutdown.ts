import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { elegantShutdown } from "../shutdown.js";
import { pendingCount } from "../message-store.js";

const DESCRIPTION =
  "Shuts down the MCP server process cleanly. Notifies all active sessions, " +
  "flushes pending queues, dumps the session log, then exits. The MCP host " +
  "will detect the exit and can relaunch it automatically. Reconnecting to " +
  "the server after shutdown starts it back up. Call this after running " +
  "`pnpm build` to pick up code changes. " +
  "If there are pending messages in the queue, the call fails unless " +
  "`force: true` is passed.";

export function register(server: McpServer) {
  server.registerTool(
    "shutdown",
    {
      description: DESCRIPTION,
      inputSchema: {
        force: z
          .boolean()
          .optional()
          .describe(
            "Bypass the pending-message safety guard. Required when unprocessed " +
            "messages exist in the queue.",
          ),
      },
    },
    ({ force }) => {
      const pending = pendingCount();
      if (pending > 0 && !force) {
        return toError({
          code: "PENDING_MESSAGES" as const,
          message:
            `${pending} pending update(s) in queue — process them first ` +
            `or pass \`force: true\` to shut down anyway.`,
        });
      }

      // Send the response first so the caller gets confirmation before we exit
      const result = toResult({ shutting_down: true, pending_flushed: pending });
      setImmediate(() => { void elegantShutdown(); });
      return result;
    },
  );
}
