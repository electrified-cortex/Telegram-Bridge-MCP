import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { dumpTimeline } from "../message-store.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Returns recent conversation history from the timeline. " +
  "Use count to limit results (default 20, max 50). " +
  "Use before_id to page backwards — returns events older than the event with that ID. " +
  "Events are returned oldest-first (chronological order). " +
  "has_more is true when older events exist beyond the returned window.";

export function register(server: McpServer) {
  server.registerTool(
    "get_chat_history",
    {
      description: DESCRIPTION,
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Number of events to return (default 20, max 50)"),
        before_id: z
          .number()
          .int()
          .optional()
          .describe(
            "Return events older than the event with this ID (page backwards). " +
            "Omit to get the most recent events.",
          ),
              token: TOKEN_SCHEMA,
},
    },
    ({ count, before_id, token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      const timeline = dumpTimeline();

      let windowEnd: number;
      if (before_id !== undefined) {
        const idx = timeline.findIndex(e => e.id === before_id);
        if (idx === -1) {
          return toError({
            code: "EVENT_NOT_FOUND" as const,
            message: `No event with id ${before_id} found in the timeline.`,
          });
        }
        windowEnd = idx;
      } else {
        windowEnd = timeline.length;
      }

      const windowStart = Math.max(0, windowEnd - count);
      const events = timeline.slice(windowStart, windowEnd);
      const hasMore = windowStart > 0;

      return toResult({ events, has_more: hasMore });
    },
  );
}
