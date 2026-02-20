import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Returns the full agent behavior guide (BEHAVIOR.md) as a tool result.
 *
 * Tools are surfaced universally by all MCP clients. Call this at the start
 * of any session to understand how to interact with this MCP server — what
 * tools to use, how to communicate with the user, and behavioral conventions.
 *
 * The same content is also available as the `telegram-bridge-mcp://agent-guide` resource.
 */
export function register(server: McpServer) {
  server.tool(
    "get_agent_guide",
    "Returns the agent behavior guide for this MCP server. Call this at the start of a session to understand how to communicate with the user, which tools to use, and all behavioral conventions. Also available as the `telegram-bridge-mcp://agent-guide` resource.",
    {},
    async () => {
      const content = readFileSync(
        join(__dirname, "..", "..", "BEHAVIOR.md"),
        "utf-8"
      );
      return toResult({ guide: content });
    }
  );
}
