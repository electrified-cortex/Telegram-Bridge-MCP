import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerDequeueUpdate } from "./tools/dequeue_update.js";
import { register as registerGetMessage } from "./tools/get_message.js";
import { register as registerSendText } from "./tools/send_text.js";
import { register as registerSendMessage } from "./tools/send_message.js";
import { register as registerSendChoice } from "./tools/send_choice.js";
import { register as registerSendFile } from "./tools/send_file.js";
import { register as registerAppendText } from "./tools/append_text.js";
import { register as registerShowAnimation } from "./tools/show_animation.js";
import { register as registerCancelAnimation } from "./tools/cancel_animation.js";
import { register as registerSetDefaultAnimation } from "./tools/set_default_animation.js";
import { register as registerSendTextAsVoice } from "./tools/send_text_as_voice.js";
import { register as registerNotify } from "./tools/notify.js";
import { register as registerEditMessageText } from "./tools/edit_message_text.js";
import { register as registerEditMessage } from "./tools/edit_message.js";
import { register as registerDeleteMessage } from "./tools/delete_message.js";
import { register as registerAsk } from "./tools/ask.js";
import { register as registerChoose } from "./tools/choose.js";
import { register as registerConfirm } from "./tools/confirm.js";
import { register as registerAnswerCallbackQuery } from "./tools/answer_callback_query.js";
import { register as registerShowTyping } from "./tools/show_typing.js";
import { register as registerSendChatAction } from "./tools/send_chat_action.js";
import { register as registerSendNewChecklist } from "./tools/send_new_checklist.js";
import { register as registerSetReaction } from "./tools/set_reaction.js";
import { register as registerPinMessage } from "./tools/pin_message.js";
import { register as registerDownloadFile } from "./tools/download_file.js";
import { register as registerTranscribeVoice } from "./tools/transcribe_voice.js";
import { register as registerSetCommands } from "./tools/set_commands.js";
import { register as registerSetTopic } from "./tools/set_topic.js";
import { register as registerGetMe } from "./tools/get_me.js";
import { register as registerGetChat } from "./tools/get_chat.js";
import { register as registerGetAgentGuide } from "./tools/get_agent_guide.js";
import { register as registerDumpSessionRecord } from "./tools/dump_session_record.js";
import { register as registerShutdownServer } from "./tools/shutdown.js";
import { register as registerSessionStart } from "./tools/session_start.js";
import { register as registerCloseSession } from "./tools/close_session.js";
import { register as registerListSessions } from "./tools/list_sessions.js";
import { register as registerSendNewProgress } from "./tools/send_new_progress.js";
import { register as registerUpdateProgress } from "./tools/update_progress.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-bridge-mcp",
    version: "3.0.0",
  });

  // ── High-level agent tools (use these 99% of the time) ─────────────────
  registerGetAgentGuide(server);
  registerSetTopic(server);
  registerNotify(server);
  registerAsk(server);
  registerChoose(server);  registerSendChoice(server);  registerSendNewChecklist(server);  registerSendNewProgress(server);
  registerConfirm(server);

  // ── Polling ─────────────────────────────────────────────────────────────
  registerDequeueUpdate(server);
  registerGetMessage(server);

  // ── Messaging ───────────────────────────────────────────────────────────
  registerSendMessage(server);
  registerEditMessage(server);
  registerSendText(server);
  registerSendTextAsVoice(server);
  registerSendFile(server);
  registerEditMessageText(server);
  registerAppendText(server);
  registerDeleteMessage(server);

  // ── Visual (animations) ────────────────────────────────────────────────
  registerShowAnimation(server);
  registerCancelAnimation(server);
  registerSetDefaultAnimation(server);

  // ── Interaction primitives ─────────────────────────────────────────────
  registerAnswerCallbackQuery(server);

  // ── Status ─────────────────────────────────────────────────────────────
  registerShowTyping(server);
  registerSendChatAction(server);

  // ── Reactions ──────────────────────────────────────────────────────────
  registerSetReaction(server);

  // ── Pin ────────────────────────────────────────────────────────────────
  registerPinMessage(server);

  // ── File operations ────────────────────────────────────────────────────
  registerDownloadFile(server);
  registerTranscribeVoice(server);

  // ── Config ─────────────────────────────────────────────────────────────
  registerSetCommands(server);

  // ── Info ───────────────────────────────────────────────────────────────
  registerGetMe(server);
  registerGetChat(server);

  // ── Progress ───────────────────────────────────────────────────────────
  registerUpdateProgress(server);

  // ── Session ────────────────────────────────────────────────────────────
  registerSessionStart(server);
  registerCloseSession(server);
  registerListSessions(server);
  registerDumpSessionRecord(server);

  // ── System ─────────────────────────────────────────────────────────────
  registerShutdownServer(server);

  // ── Resources ────────────────────────────────────────────────────────────
  const agentGuideContent = readFileSync(
    join(__dirname, "..", "docs", "behavior.md"),
    "utf-8"
  );
  const communicationContent = readFileSync(
    join(__dirname, "..", "docs", "communication.md"),
    "utf-8"
  );
  // Strip YAML frontmatter (--- ... ---) before serving as a resource
  const quickReferenceRaw = readFileSync(
    join(__dirname, "..", ".github", "instructions", "telegram-communication.instructions.md"),
    "utf-8"
  );
  const quickReferenceContent = quickReferenceRaw.replace(/^---[\s\S]*?---\n/, "").trimStart();
  const setupContent = readFileSync(
    join(__dirname, "..", "docs", "setup.md"),
    "utf-8"
  );
  const formattingContent = readFileSync(
    join(__dirname, "..", "docs", "formatting.md"),
    "utf-8"
  );

  server.registerResource(
    "agent-guide",
    "telegram-bridge-mcp://agent-guide",
    { mimeType: "text/markdown", description: "Agent behavior guide for this MCP server. Read this at session start to understand how to communicate with the user and which tools to use." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://agent-guide",
          mimeType: "text/markdown",
          text: agentGuideContent,
        },
      ],
    })
  );

  server.registerResource(
    "communication-guide",
    "telegram-bridge-mcp://communication-guide",
    { mimeType: "text/markdown", description: "Compact Telegram communication patterns: tool selection, hard rules, commit/push flow, multi-step tasks, and loop behavior." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://communication-guide",
          mimeType: "text/markdown",
          text: communicationContent,
        },
      ],
    })
  );

  server.registerResource(
    "quick-reference",
    "telegram-bridge-mcp://quick-reference",
    { mimeType: "text/markdown", description: "Hard rules + tool selection table for Telegram communication. Minimal injected rules card — full detail in communication-guide." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://quick-reference",
          mimeType: "text/markdown",
          text: quickReferenceContent,
        },
      ],
    })
  );

  server.registerResource(
    "setup-guide",
    "telegram-bridge-mcp://setup-guide",
    { mimeType: "text/markdown", description: "Step-by-step guide to creating a Telegram bot and running pnpm pair to configure this MCP server." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://setup-guide",
          mimeType: "text/markdown",
          text: setupContent,
        },
      ],
    })
  );

  server.registerResource(
    "formatting-guide",
    "telegram-bridge-mcp://formatting-guide",
    { mimeType: "text/markdown", description: "Reference for Markdown/HTML/MarkdownV2 formatting in Telegram messages. Consult this when unsure how to format text." },
    () => ({
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
