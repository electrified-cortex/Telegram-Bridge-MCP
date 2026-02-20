import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "get_chat",
    "Returns detailed information about the configured chat (id, type, title, username, member count, etc.).",
    {},
    async () => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const chat = await getApi().getChat(chatId);
        return toResult({
          type: chat.type,
          title: (chat as any).title,
          description: (chat as any).description,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
