import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cancelTyping } from "../typing-state.js";

/**
 * Explicitly stops the typing indicator started by show_typing.
 * No-op if no indicator is currently running.
 */
export function register(server: McpServer) {
  server.tool(
    "cancel_typing",
    "Immediately stops the typing indicator started by show_typing. No-op if no indicator is running. The indicator is also cancelled automatically when any message is sent, so this is only needed when you decide not to send a message after all.",
    {},
    async () => {
      const wasActive = cancelTyping();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ cancelled: wasActive }),
          },
        ],
      };
    }
  );
}
