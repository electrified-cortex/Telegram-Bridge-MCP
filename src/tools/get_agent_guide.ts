import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult } from "../telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DESCRIPTION =
  "Returns the agent behavior guide for this MCP server. Call this " +
  "at the start of a session to understand how to communicate with " +
  "the user, which tools to use, and all behavioral conventions. " +
  "Also available as the `telegram-bridge-mcp://agent-guide` resource.";

export function register(server: McpServer) {
  server.registerTool(
    "get_agent_guide",
    {
      description: DESCRIPTION,
    },
    async () => {
      const content = readFileSync(
        join(__dirname, "..", "..", "BEHAVIOR.md"),
        "utf-8"
      );
      return toResult({ guide: content });
    }
  );
}
