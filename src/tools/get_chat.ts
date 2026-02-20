import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "get_chat",
    "Returns detailed information about a chat (id, type, title, username, member count, etc.).",
    {
      chat_id: z
        .string()
        .describe("Chat ID (number as string) or @username"),
    },
    async ({ chat_id }) => {
      try {
        return toResult(await getApi().getChat(chat_id));
      } catch (err) {
        return toError(err);
      }
    }
  );
}
