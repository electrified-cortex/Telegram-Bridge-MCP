import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { cancelAnimation } from "../animation-state.js";
import { requireAuth } from "../session-gate.js";

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
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    async ({ text, parse_mode, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      try {
        const result = await cancelAnimation(_sid, text, parse_mode);
        return toResult(result);
      } catch (err) {
        return toError(err);
      }
    },
  );
}
