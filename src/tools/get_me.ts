import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "get_me",
    "Returns basic information about the bot (id, username, name, capabilities).",
    {},
    async () => {
      try {
        return toResult(await getApi().getMe());
      } catch (err) {
        return toError(err);
      }
    }
  );
}
