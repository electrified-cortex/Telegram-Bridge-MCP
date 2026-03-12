import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError } from "../telegram.js";

const DESCRIPTION =
  "Returns basic information about the bot (id, username, name, capabilities).";

export function register(server: McpServer) {
  server.registerTool(
    "get_me",
    {
      description: DESCRIPTION,
    },
    async () => {
      try {
        return toResult(await getApi().getMe());
      } catch (err) {
        return toError(err);
      }
    }
  );
}
