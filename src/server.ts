import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Low-level tools
import { register as registerGetMe } from "./tools/get_me.js";
import { register as registerSendMessage } from "./tools/send_message.js";
import { register as registerGetUpdates } from "./tools/get_updates.js";
import { register as registerAnswerCallbackQuery } from "./tools/answer_callback_query.js";
import { register as registerEditMessageText } from "./tools/edit_message_text.js";
import { register as registerGetChat } from "./tools/get_chat.js";
import { register as registerSendPhoto } from "./tools/send_photo.js";
import { register as registerForwardMessage } from "./tools/forward_message.js";
import { register as registerPinMessage } from "./tools/pin_message.js";
import { register as registerDeleteMessage } from "./tools/delete_message.js";
import { register as registerWaitForCallbackQuery } from "./tools/wait_for_callback_query.js";
import { register as registerWaitForMessage } from "./tools/wait_for_message.js";

// High-level agent tools
import { register as registerNotify } from "./tools/notify.js";
import { register as registerAsk } from "./tools/ask.js";
import { register as registerChoose } from "./tools/choose.js";
import { register as registerUpdateStatus } from "./tools/update_status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-mcp",
    version: "1.0.0",
  });

  // ── High-level agent tools (use these 99% of the time) ─────────────────
  registerNotify(server);
  registerAsk(server);
  registerChoose(server);
  registerUpdateStatus(server);

  // ── Interaction primitives ───────────────────────────────────────────────
  registerWaitForCallbackQuery(server);
  registerWaitForMessage(server);
  registerAnswerCallbackQuery(server);

  // ── Messaging ───────────────────────────────────────────────────────────
  registerSendMessage(server);
  registerEditMessageText(server);
  registerSendPhoto(server);
  registerForwardMessage(server);
  registerDeleteMessage(server);
  registerPinMessage(server);

  // ── Bot / chat info ──────────────────────────────────────────────────────
  registerGetMe(server);
  registerGetChat(server);

  // ── Polling ──────────────────────────────────────────────────────────────
  registerGetUpdates(server);

  // ── Resources ────────────────────────────────────────────────────────────
  const setupContent = readFileSync(
    join(__dirname, "..", "SETUP.md"),
    "utf-8"
  );

  server.resource(
    "setup-guide",
    "telegram-mcp://setup-guide",
    { mimeType: "text/markdown" },
    async () => ({
      contents: [
        {
          uri: "telegram-mcp://setup-guide",
          mimeType: "text/markdown",
          text: setupContent,
        },
      ],
    })
  );

  return server;
}
