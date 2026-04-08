import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Acknowledges a callback query from an inline button press. " +
  "Only needed when handling button presses manually — " +
  "choose, confirm, and send_choice auto-ack button presses automatically. " +
  "For non-blocking keyboards, use send_choice. " +
  "Must be called within 30 s of receiving the update. " +
  "Optionally shows a toast or alert to the user.";

export function register(server: McpServer) {
  server.registerTool(
    "answer_callback_query",
    {
      description: DESCRIPTION,
      inputSchema: {
        callback_query_id: z.string().describe("ID from the callback_query update"),
      text: z
        .string()
        .optional()
        .describe("Toast notification text shown to the user (up to 200 chars)"),
      show_alert: z
        .boolean()
        .optional()
        .describe("Show as a dialog alert instead of a toast"),
      url: z
        .string()
        .optional()
        .describe("URL to open in the user's browser (for games)"),
      cache_time: z
        .number()
        .int()
        .optional()
        .describe("Seconds the result may be cached client-side"),
              token: TOKEN_SCHEMA,
},
    },
    async ({ callback_query_id, text, show_alert, url, cache_time, token}) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      try {
        const ok = await getApi().answerCallbackQuery(callback_query_id, {
          text,
          show_alert,
          url,
          cache_time,
        });
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
