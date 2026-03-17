import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { getMessage, getVersions, CURRENT } from "../message-store.js";
import { requireAuth } from "../session-gate.js";

const DESCRIPTION =
  "Look up a stored message by ID and optional version. Returns detail including " +
  "text/caption, file_id, media metadata, and edit history. " +
  "version=-1 (default) = latest; 0 = original; 1+ = edit history (bot messages only). " +
  "Returns all available version keys so the agent knows what history exists. " +
  "Only call for message IDs already known to this agent session " +
  "(e.g. delivered via dequeue_update or referenced by the user). " +
  "Do not probe arbitrary IDs to discover conversation history.";

export function register(server: McpServer) {
  server.registerTool(
    "get_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().min(1).describe("Message ID to look up"),
        version: z
          .number()
          .int()
          .default(CURRENT)
          .describe("Version: -1 = current/latest (default), 0 = original, 1+ = edit history"),
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    ({ message_id, version, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const event = getMessage(message_id, version);
      if (!event) {
        return toError({
          code: "MESSAGE_NOT_FOUND" as const,
          message: `Message ${message_id} (version ${version}) not found in store. It may have been evicted or was never recorded.`,
        });
      }

      const versions = getVersions(message_id);
      const { _update: _, ...rest } = event;

      return toResult({
        ...rest,
        versions,
      });
    },
  );
}
