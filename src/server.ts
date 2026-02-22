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
import { register as registerSetReaction } from "./tools/set_reaction.js";
import { register as registerSendPhoto } from "./tools/send_photo.js";
import { register as registerSendDocument } from "./tools/send_document.js";
import { register as registerDownloadFile } from "./tools/download_file.js";
import { register as registerForwardMessage } from "./tools/forward_message.js";
import { register as registerPinMessage } from "./tools/pin_message.js";
import { register as registerDeleteMessage } from "./tools/delete_message.js";
import { register as registerSendChatAction } from "./tools/send_chat_action.js";
import { register as registerShowTyping } from "./tools/show_typing.js";
import { register as registerCancelTyping } from "./tools/cancel_typing.js";
import { register as registerRestartServer } from "./tools/restart_server.js";
import { register as registerWaitForCallbackQuery } from "./tools/wait_for_callback_query.js";
import { register as registerWaitForMessage } from "./tools/wait_for_message.js";

// High-level agent tools
import { register as registerNotify } from "./tools/notify.js";
import { register as registerAsk } from "./tools/ask.js";
import { register as registerChoose } from "./tools/choose.js";
import { register as registerUpdateStatus } from "./tools/update_status.js";
import { register as registerGetAgentGuide } from "./tools/get_agent_guide.js";
import { register as registerSendConfirmation } from "./tools/send_confirmation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-bridge-mcp",
    version: "1.0.0",
  });

  // ── High-level agent tools (use these 99% of the time) ─────────────────
  registerGetAgentGuide(server);
  registerNotify(server);
  registerAsk(server);
  registerChoose(server);
  registerUpdateStatus(server);
  registerSendConfirmation(server);

  // ── Interaction primitives ───────────────────────────────────────────────
  registerWaitForCallbackQuery(server);
  registerWaitForMessage(server);
  registerAnswerCallbackQuery(server);

  // ── Messaging ───────────────────────────────────────────────────────────
  registerSendChatAction(server);
  registerShowTyping(server);
  registerCancelTyping(server);
  registerRestartServer(server);
  registerSendMessage(server);
  registerEditMessageText(server);
  registerSendPhoto(server);
  registerSendDocument(server);
  registerDownloadFile(server);
  registerForwardMessage(server);
  registerDeleteMessage(server);
  registerPinMessage(server);

  // ── Bot / chat info ──────────────────────────────────────────────────────
  registerGetMe(server);
  registerGetChat(server);

  // ── Reactions ────────────────────────────────────────────────────────────
  registerSetReaction(server);

  // ── Polling ──────────────────────────────────────────────────────────────
  registerGetUpdates(server);

  // ── Resources ────────────────────────────────────────────────────────────
  const agentGuideContent = readFileSync(
    join(__dirname, "..", "BEHAVIOR.md"),
    "utf-8"
  );
  const setupContent = readFileSync(
    join(__dirname, "..", "SETUP.md"),
    "utf-8"
  );
  const formattingContent = readFileSync(
    join(__dirname, "..", "FORMATTING.md"),
    "utf-8"
  );

  server.resource(
    "agent-guide",
    "telegram-bridge-mcp://agent-guide",
    { mimeType: "text/markdown", description: "Agent behavior guide for this MCP server. Read this at session start to understand how to communicate with the user and which tools to use." },
    async () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://agent-guide",
          mimeType: "text/markdown",
          text: agentGuideContent,
        },
      ],
    })
  );

  server.resource(
    "setup-guide",
    "telegram-bridge-mcp://setup-guide",
    { mimeType: "text/markdown", description: "Step-by-step guide to creating a Telegram bot and running pnpm pair to configure this MCP server." },
    async () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://setup-guide",
          mimeType: "text/markdown",
          text: setupContent,
        },
      ],
    })
  );

  server.resource(
    "formatting-guide",
    "telegram-bridge-mcp://formatting-guide",
    { mimeType: "text/markdown", description: "Reference for Markdown/HTML/MarkdownV2 formatting in Telegram messages. Consult this when unsure how to format text." },
    async () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://formatting-guide",
          mimeType: "text/markdown",
          text: formattingContent,
        },
      ],
    })
  );

  return server;
}
