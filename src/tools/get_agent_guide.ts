import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toResult, toError } from "../telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DESCRIPTION =
  "Returns the agent behavior guide for this MCP server. Call this " +
  "after session_start to understand how to communicate with " +
  "the user, which tools to use, and all behavioral conventions. " +
  "Also available as the `telegram-bridge-mcp://agent-guide` resource.";

export function register(server: McpServer) {
  server.registerTool(
    "get_agent_guide",
    {
      description: DESCRIPTION,
    },
    () => {
      try {
        const content = readFileSync(
          join(__dirname, "..", "..", "docs", "behavior.md"),
          "utf-8"
        );
        return toResult({ guide: content });
      } catch {
        return toError({ code: "GUIDE_NOT_FOUND" as const, message: "Agent guide unavailable: docs/behavior.md not found in distribution." });
      }
    }
  );
}
