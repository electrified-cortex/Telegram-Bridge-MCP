import { createRequire } from "module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError } from "../telegram.js";

const require = createRequire(import.meta.url);
let MCP_VERSION = "unknown";
try {
  const pkg = require("../../package.json") as { version: string };
  MCP_VERSION = pkg.version;
} catch {
  // package.json not found (deployment artifact without it)
}

let mcpCommit = "dev";
let mcpBuildTime = "unknown";
try {
  const info = require("./build-info.json") as { BUILD_COMMIT: string; BUILD_TIME: string };
  mcpCommit = info.BUILD_COMMIT;
  mcpBuildTime = info.BUILD_TIME;
} catch {
  // build-info.json not generated yet (local dev without a build)
}

const DESCRIPTION =
  "Returns basic information about the bot (id, username, name, capabilities) plus the running MCP server version and build fingerprint.";

export function register(server: McpServer) {
  server.registerTool(
    "get_me",
    {
      description: DESCRIPTION,
    },
    async () => {
      try {
        const botInfo = await getApi().getMe();
        return toResult({ mcp_version: MCP_VERSION, mcp_commit: mcpCommit, mcp_build_time: mcpBuildTime, ...botInfo });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
