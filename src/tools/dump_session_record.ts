import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, resolveChat, toError } from "../telegram.js";
import { dumpTimeline, timelineSize, storeSize } from "../message-store.js";
import { getSessionLogMode } from "../config.js";
import { advanceDumpCursor, isInternalTimelineEvent, markInternalMessage } from "../built-in-commands.js";

const DESCRIPTION =
  "Snapshots the conversation timeline as a JSON file and sends it to the Telegram chat " +
  "as a downloadable document. The file will appear as a bot message that both the user " +
  "and agent can download later via download_file. " +
  "Covers all inbound and outbound events since server start (rolling limit of 1000 events). " +
  "This is a broad history dump containing sensitive user content. " +
  "Only call when the user explicitly requests session history, context recovery, or an audit.";

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
        if (getSessionLogMode() === null) {
          return {
            content: [{
              type: "text" as const,
              text: "Session log is disabled. Use /session in Telegram to enable it.",
            }],
          };
        }

        const chatId = resolveChat();
        if (typeof chatId !== "number") {
          return { content: [{ type: "text" as const, text: "No chat configured." }] };
        }

        const full = dumpTimeline().filter(evt => !isInternalTimelineEvent(evt));
        const timeline = full.length > limit ? full.slice(-limit) : full;

        if (timeline.length === 0) {
          return { content: [{ type: "text" as const, text: "No events captured yet." }] };
        }

        const now = new Date().toISOString();
        const payload = {
          generated: now,
          timeline_events: timelineSize(),
          unique_messages: storeSize(),
          returned: timeline.length,
          truncated: full.length > limit,
          timeline,
        };

        const { InputFile } = await import("grammy");
        const buf = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
        const file = new InputFile(buf, `session-log-${now.replace(/[:.]/g, "-")}.json`);
        const label = `🗒 Session record · ${timeline.length} events`;
        const api = getApi();
        const msg = await api.sendDocument(chatId, file, {
          caption: label,
        }) as { message_id: number; document?: { file_id?: string } };

        markInternalMessage(msg.message_id);
        advanceDumpCursor();

        const fileId = msg.document?.file_id;

        // Amend caption with file_id so it's recoverable after a crash
        if (fileId) {
          try {
            await api.editMessageCaption(chatId, msg.message_id, {
              caption: `${label}\nFile ID: \`${fileId}\``,
              parse_mode: "Markdown",
            });
          } catch { /* best effort */ }
        }

        const result: Record<string, unknown> = {
          message_id: msg.message_id,
          event_count: timeline.length,
        };
        if (fileId) result.file_id = fileId;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result),
          }],
        };
      } catch (err) {
        return toError(err);
      }
    }
  );
}
