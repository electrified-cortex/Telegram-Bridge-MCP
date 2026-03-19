import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { pollButtonPress, ackAndEditSelection, editWithTimedOut } from "./button-helpers.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const CONFIRM_DATA = "get_chat_yes";
const DENY_DATA = "get_chat_no";
const TIMEOUT_SECONDS = 60;

const DESCRIPTION =
  "Returns information about the configured chat: id, type, title, " +
  "username, first/last name, and description. Requires user " +
  "approval — a confirmation prompt is sent and the tool waits until " +
  "the user presses Allow or Deny. Returns { approved: true, ...chatInfo } " +
  "on approval, or { approved: false, timed_out: true|false } on denial/timeout.";

export function register(server: McpServer) {
  server.registerTool(
    "get_chat",
    {
      description: DESCRIPTION,
      inputSchema: {
        identity: IDENTITY_SCHEMA,
      },
    },
    async ({ identity }) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const promptText = "🔒 The agent is requesting **chat information** (id, type, title, username, name, description). Allow?";
        const sent = await getApi().sendMessage(chatId, markdownToV2(promptText), {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Allow", callback_data: CONFIRM_DATA },
              { text: "❌ Deny", callback_data: DENY_DATA },
            ]],
          },
          _rawText: promptText,
        } as Record<string, unknown>);

        const result = await pollButtonPress(chatId, sent.message_id, TIMEOUT_SECONDS);

        if (!result) {
          await editWithTimedOut(chatId, sent.message_id, promptText);
          return toResult({ approved: false, timed_out: true, message_id: sent.message_id });
        }

        const approved = result.data === CONFIRM_DATA;
        await ackAndEditSelection(
          chatId, sent.message_id, promptText,
          approved ? "✅ Allowed" : "❌ Denied",
          result.callback_query_id,
        );

        if (!approved) {
          return toResult({ approved: false, timed_out: false, message_id: sent.message_id });
        }

        const chat = await getApi().getChat(chatId);
        const c = chat as unknown as Record<string, unknown>;
        return toResult({
          approved: true,
          id: chat.id,
          type: chat.type,
          title: c.title,
          username: c.username,
          first_name: c.first_name,
          last_name: c.last_name,
          description: c.description,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
