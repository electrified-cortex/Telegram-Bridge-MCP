import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult } from "../telegram.js";
import { setTopic, getTopic, clearTopic } from "../topic-state.js";

const DESCRIPTION =
  "Sets a default title (e.g. \"Refactor Agent\") that is automatically " +
  "prepended to every outbound message from this MCP server instance as " +
  "\"[Title]\". Useful when multiple VS Code windows share the same " +
  "Telegram chat — each process can label its messages so you know which " +
  "agent sent what. Scoped to this server process: works best with one " +
  "active chat per VS Code instance. Pass an empty string to clear.";

export function register(server: McpServer) {
  server.registerTool(
    "set_topic",
    {
      description: DESCRIPTION,
      inputSchema: {
        topic: z
        .string()
        .max(32)
        .describe("Short label to prepend to all outbound messages, e.g. \"Refactor Agent\". Pass empty string to clear."),
      },
    },
    async ({ topic }) => {
      const previous = getTopic();
      if (topic.trim() === "") {
        clearTopic();
        return toResult({ topic: null, previous, cleared: true });
      }
      setTopic(topic);
      return toResult({ topic: getTopic(), previous, set: true });
    },
  );
}
