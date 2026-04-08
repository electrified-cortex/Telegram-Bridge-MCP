import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInSessionContext } from "./session-context.js";
import { getActiveSession } from "./session-manager.js";
import { runInTokenHintContext } from "./tools/identity-schema.js";
import { invokePreToolHook } from "./tool-hooks.js";
import { toError } from "./telegram.js";

import { register as registerDequeueUpdate } from "./tools/dequeue.js";
import { register as registerGetMessage } from "./tools/get_message.js";
import { register as registerGetChatHistory } from "./tools/get_chat_history.js";
import { register as registerSend } from "./tools/send.js";
import { register as registerSendChoice } from "./tools/send_choice.js";
import { register as registerSendFile } from "./tools/send_file.js";
import { register as registerAppendText } from "./tools/append_text.js";
import { register as registerShowAnimation } from "./tools/show_animation.js";
import { register as registerCancelAnimation } from "./tools/cancel_animation.js";
import { register as registerSetDefaultAnimation } from "./tools/set_default_animation.js";
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
import { register as registerSetVoice } from "./tools/set_voice.js";
import { register as registerSetReminder } from "./tools/set_reminder.js";
import { register as registerCancelReminder } from "./tools/cancel_reminder.js";
import { register as registerListReminders } from "./tools/list_reminders.js";
import { register as registerGetChat } from "./tools/get_chat.js";
import { register as registerHelp } from "./tools/help.js";
import { register as registerDumpSessionRecord } from "./tools/dump_session_record.js";
import { register as registerRollLog } from "./tools/roll_log.js";
import { register as registerGetLog } from "./tools/get_log.js";
import { register as registerListLogs } from "./tools/list_logs.js";
import { register as registerDeleteLog } from "./tools/delete_log.js";
import { register as registerToggleLogging } from "./tools/toggle_logging.js";
import { register as registerShutdownServer } from "./tools/shutdown.js";
import { register as registerSessionStart } from "./tools/session_start.js";
import { register as registerCloseSession } from "./tools/close_session.js";
import { register as registerListSessions } from "./tools/list_sessions.js";
import { register as registerSendNewProgress } from "./tools/send_new_progress.js";
import { register as registerUpdateProgress } from "./tools/update_progress.js";
import { register as registerSendDirectMessage } from "./tools/send_direct_message.js";
import { register as registerRouteMessage } from "./tools/route_message.js";
import { register as registerRenameSession } from "./tools/rename_session.js";
import { register as registerGetDebugLog } from "./tools/get_debug_log.js";
import { register as registerNotifyShutdownWarning } from "./tools/notify_shutdown_warning.js";
import { register as registerSaveProfile } from "./tools/save_profile.js";
import { register as registerLoadProfile } from "./tools/load_profile.js";
import { register as registerImportProfile } from "./tools/import_profile.js";
import { register as registerSetDequeueDefault } from "./tools/set_dequeue_default.js";
import { initAgentApprovalTool } from "./agent-approval.js";
import { register as registerAction } from "./tools/action.js";

import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

const LOG_FIELD_CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

/**
 * Sanitize a log field by stripping \r, \n, and other ASCII control characters
 * to prevent log injection attacks (fake log lines, ANSI escapes, etc.).
 */
function normalizeLogField(s: string): string {
  // Strip \r, \n, and other ASCII control characters to prevent log injection.
  return s.replace(LOG_FIELD_CONTROL_CHARS_RE, " ").trim();
}

/**
 * Writes a [hook:blocked] log line to stderr.
 * Exported so it can be tested independently of the full server setup.
 */
export function logBlockedToolCall(toolName: string, reason: string): void {
  process.stderr.write(`[hook:blocked] ${normalizeLogField(toolName)} — ${normalizeLogField(reason)}\n`);
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-bridge-mcp",
    version: PKG_VERSION,
  });

  // ── Session context middleware ──────────────────────────────────────────
  // Wrap every tool handler in AsyncLocalStorage so outbound messages
  // are attributed to the correct session even when multiple sessions
  // interleave tool calls concurrently.
  const _origRegisterTool = server.registerTool.bind(server);
  type AnyConfig = Parameters<typeof _origRegisterTool>[1];
  type AnyCallback = Parameters<typeof _origRegisterTool>[2];
  // `any[]` is intentional: this wrapper must accept any tool callback signature
  // without knowing the parameter types at compile time. The real type safety
  // lives in individual tool registrations via their Zod inputSchema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CallableCb = (...a: any[]) => unknown;
  server.registerTool = ((
    name: string,
    config: AnyConfig,
    cb: AnyCallback,
  ) => {
    const original = cb as unknown as CallableCb;
    const wrappedCb = (
      (args: Record<string, unknown>, extra: unknown) => {
        // Decode sid from token (sid * 1_000_000 + pin) for session context.
        // Falls back to active session for tools that don't require auth.
        // Each call is also wrapped in a token-hint context so the TOKEN_SCHEMA
        // preprocess and the handler share per-request hint state, preventing
        // concurrent requests from corrupting each other's hint flag.
        const token = args.token;
        const sid = (typeof token === "number" && token > 0)
          ? Math.floor(token / 1_000_000)
          : getActiveSession();

        const run = async () => {
          // Pre-tool hook fires before the original handler executes.
          // A hook returning allowed:false short-circuits the call and
          // returns a 403-style error.  If the hook itself throws, we
          // fail safe by treating it as blocked.
          let hookResult: { allowed: boolean; reason?: string };
          try {
            hookResult = await invokePreToolHook(name, args);
          } catch (err) {
            // Hook threw — treat as blocked to fail safe
            const reason = err instanceof Error ? err.message : "Hook error";
            logBlockedToolCall(name, reason);
            return toError({ code: "BLOCKED", message: `Pre-tool hook error: ${reason}` });
          }
          if (!hookResult.allowed) {
            const reason = hookResult.reason ?? "Blocked by pre-tool hook";
            logBlockedToolCall(name, reason);
            return toError({ code: "BLOCKED", message: reason });
          }
          return original(args, extra);
        };

        if (sid > 0) {
          return runInTokenHintContext(() =>
            runInSessionContext(sid, run),
          );
        }
        return runInTokenHintContext(run);
      }
    ) as typeof cb;
    return _origRegisterTool(name, config, wrappedCb);
  }) as typeof server.registerTool;

  // ── High-level agent tools (use these 99% of the time) ─────────────────
  registerHelp(server);
  registerSetTopic(server);
  registerSetVoice(server);
  registerSaveProfile(server);
  registerLoadProfile(server);
  registerImportProfile(server);
  registerSetReminder(server);
  registerCancelReminder(server);
  registerListReminders(server);
  registerNotify(server);
  registerAsk(server);
  registerChoose(server);  registerSendChoice(server);  registerSendNewChecklist(server);  registerSendNewProgress(server);
  registerConfirm(server);

  // ── Polling ─────────────────────────────────────────────────────────────
  registerDequeueUpdate(server);
  registerSetDequeueDefault(server);
  registerGetMessage(server);
  registerGetChatHistory(server);

  // ── Messaging ───────────────────────────────────────────────────────────
  registerSend(server);
  registerEditMessage(server);
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

  registerGetChat(server);

  // ── Progress ───────────────────────────────────────────────────────────
  registerUpdateProgress(server);

  // ── Session ────────────────────────────────────────────────────────────
  registerSessionStart(server);
  registerCloseSession(server);
  registerListSessions(server);
  initAgentApprovalTool(server);
  registerSendDirectMessage(server);
  registerRouteMessage(server);
  registerRenameSession(server);
  registerDumpSessionRecord(server);
  registerRollLog(server);
  registerGetLog(server);
  registerListLogs(server);
  registerDeleteLog(server);
  registerToggleLogging(server);
  registerGetDebugLog(server);

  // ── v6 action router ───────────────────────────────────────────────────
  registerAction(server);

  // ── System ─────────────────────────────────────────────────────────────
  registerShutdownServer(server);
  registerNotifyShutdownWarning(server);

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
