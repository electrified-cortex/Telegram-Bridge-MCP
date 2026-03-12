import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { cancelAnimation } from "../animation-state.js";

const DESCRIPTION =
  "Stop the active animation. Without text: deletes the placeholder. " +
  "With text: edits the placeholder to show the provided text, making it " +
  "a permanent logged message. Returns { cancelled, message_id? }. " +
  "No-op if no animation is active.";

export function register(server: McpServer) {
  server.registerTool(
    "cancel_animation",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z
          .string()
          .optional()
          .describe("Optional replacement text. Turns the placeholder into a real message."),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Parse mode for replacement text"),
      },
    },
    async ({ text, parse_mode }) => {
      try {
        const result = await cancelAnimation(text, parse_mode);
        return toResult(result);
      } catch (err) {
        return toError(err);
      }
    },
  );
}
