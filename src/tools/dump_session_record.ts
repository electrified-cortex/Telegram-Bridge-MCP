import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toError } from "../telegram.js";
import { dumpTimeline, timelineSize, storeSize } from "../message-store.js";

const DESCRIPTION =
  "Returns the full conversation timeline as compact JSON — all inbound and outbound " +
  "events since server start (rolling limit of 1000 events), including user messages, " +
  "voice transcriptions, file metadata, locations, and contacts. " +
  "This is a broad history dump containing sensitive user content. " +
  "Only call when the user explicitly requests session history, context recovery, or an audit. " +
  "Do not call speculatively or to discover prior context without user consent. " +
  "Use limit to control output size.";

export function register(server: McpServer) {
  server.registerTool(
    "dump_session_record",
    {
      description: DESCRIPTION,
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Max events to return (most recent). Default 100."),
      },
    },
    async ({ limit }) => {
      try {
        const full = dumpTimeline();
        const timeline = full.length > limit ? full.slice(-limit) : full;
        const summary = {
          timeline_events: timelineSize(),
          unique_messages: storeSize(),
          returned: timeline.length,
          truncated: full.length > limit,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ summary, timeline }) }],
        };
      } catch (err) {
        return toError(err);
      }
    }
  );
}
