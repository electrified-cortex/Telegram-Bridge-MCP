/**
 * Built-in server-level slash commands.
 *
 * These commands are intercepted in the update pipeline *before* any update
 * is delivered to the agent via dequeue_update. The agent never
 * sees them — the server handles them directly and responds to the user.
 *
 * Currently registered:
 *   /session  — shows a contextual session-recording control panel
 *
 * The server registers these in the Telegram command menu on startup so they
 * always appear in autocomplete regardless of what the agent has registered.
 */

import { createRequire } from "module";
import type { Update } from "grammy/types";
import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { clearCommandsOnShutdown } from "./shutdown.js";
import { stopPoller } from "./poller.js";

const require = createRequire(import.meta.url);
const { version: MCP_VERSION } = require("../package.json") as { version: string };
let _mcpCommit = "dev";
let _mcpBuildTime = "unknown";
try {
  const info = require("./tools/build-info.json") as { BUILD_COMMIT: string; BUILD_TIME: string };
  _mcpCommit = info.BUILD_COMMIT;
  _mcpBuildTime = info.BUILD_TIME;
} catch { /* build-info.json not generated yet */ }

export function getVersionString(): string {
  return `v${MCP_VERSION} (${_mcpCommit} ${_mcpBuildTime})`;
}
import {
  isRecording,
  startRecording,
  stopRecording,
  recordedCount,
  getMaxUpdates,
  getSessionEntries,
  clearRecording,
  setAutoDump,
  getAutoDumpThreshold,
} from "./session-recording.js";
import { sanitizeSessionEntries } from "./update-sanitizer.js";

// ---------------------------------------------------------------------------
// Tracking panel message IDs so callback_query intercept can route back
// ---------------------------------------------------------------------------

/** Maps from message_id → panel type so we can route callback_queries back to us. */
const _activePanels = new Map<number, "session">();

/** Set to true after sending the startup prefs prompt so we only ask once per process. */
let _sessionPrefsAsked = false;

/**
 * Unix timestamp (seconds) captured at module load — used to discard stale
 * built-in commands that were queued before this process started.
 * Prevents e.g. a lingering `/shutdown` from killing a freshly-started server.
 */
const _startupEpoch = Math.floor(Date.now() / 1000);

export function isBuiltInPanelQuery(update: Update): boolean {
  const msgId = update.callback_query?.message?.message_id;
  if (msgId === undefined) return false;
  return _activePanels.has(msgId);
}

// ---------------------------------------------------------------------------
// Public API — called by the update-intercept layer
// ---------------------------------------------------------------------------

/**
 * Sends the one-shot startup prefs questionnaire.
 * Step 1: Record / Not now.
 * Step 2 (if Record chosen): auto-dump frequency.
 * The message deletes itself once the user has answered.
 * Called from index.ts after connecting. Safe to call multiple times — only fires once.
 */
export async function sendSessionPrefsPrompt(): Promise<void> {
  if (_sessionPrefsAsked) return;
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  _sessionPrefsAsked = true;
  const api = getApi();
  try {
    const msg = await api.sendMessage(chatId, buildPrefsStep1Text(), {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buildPrefsStep1Keyboard() },
    });
    _activePanels.set(msg.message_id, "session");
  } catch { /* ignore */ }
}

function buildPrefsStep1Text(): string {
  return (
    "🎬 *Telegram Bridge MCP — Session Start*\n\n" +
    "Use /session at any time to view and manage session recording.\n\n" +
    "Would you like to record this session?"
  );
}

function buildPrefsStep1Keyboard(): { text: string; callback_data: string }[][] {
  return [[
    { text: "🔴 Record Session", callback_data: "session:prefs:record" },
    { text: "⬛ Not now",        callback_data: "session:prefs:skip" },
  ]];
}

function buildPrefsStep2Text(): string {
  return (
    "🎬 *Telegram Bridge MCP — Session Start*\n\n" +
    "Auto-dump sends the conversation log as a .txt file when the message count" +
    " hits the threshold, then resets for the next window.\n\n" +
    "Or choose *Manual* to record without auto-dump — use /session → *Dump* whenever you want a snapshot.\n\n" +
    "How many messages before auto-dump?"
  );
}

function buildPrefsStep2Keyboard(): { text: string; callback_data: string }[][] {
  return [[
    { text: "25",       callback_data: "session:auto:25" },
    { text: "50",       callback_data: "session:auto:50" },
    { text: "100",      callback_data: "session:auto:100" },
    { text: "Manual",   callback_data: "session:auto:never" },
  ]];
}

/** Built-in command metadata (for merging into set_commands menus). */
export const BUILT_IN_COMMANDS = [
  { command: "session", description: "Session recording controls" },
  { command: "version", description: "Show server version and build info" },
  { command: "shutdown", description: "Shut down the MCP server" },
] as const;

/**
 * Returns true if this update is a built-in command or a callback_query for
 * a built-in panel, AND handles it. Returns false if the update should be
 * forwarded to the agent as normal.
 */
export async function handleIfBuiltIn(update: Update): Promise<boolean> {
  // ── Built-in command message ────────────────────────────────────────────
  if (update.message?.text) {
    const entities = update.message.entities ?? [];
    const cmd = entities.find(e => e.type === "bot_command" && e.offset === 0);
    if (cmd) {
      // Ignore commands sent before this process started (prevents e.g. a
      // queued /shutdown from killing a freshly-restarted server).
      if ((update.message.date ?? 0) < _startupEpoch) {
        process.stderr.write(
          `[built-in] ignoring stale /${update.message.text.slice(1, cmd.length).split("@")[0]} `
          + `(msg date ${update.message.date}, startup ${_startupEpoch})\n`,
        );
        return true; // consumed — don't forward to agent either
      }

      const raw = update.message.text.slice(1, cmd.length).split("@")[0];
      if (raw === "session") {
        await handleSessionCommand();
        return true;
      }
      if (raw === "version") {
        await handleVersionCommand();
        return true;
      }
      if (raw === "shutdown") {
        handleShutdownCommand();
        return true;
      }
    }
  }

  // ── Callback query for a built-in panel ────────────────────────────────
  if (update.callback_query) {
    const msgId = update.callback_query.message?.message_id;
    if (msgId !== undefined && _activePanels.has(msgId)) {
      await handleSessionCallback(update.callback_query.id, msgId, update.callback_query.data ?? "");
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// /version
// ---------------------------------------------------------------------------

async function handleVersionCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const buildTimeDisplay = _mcpBuildTime.replace("T", " ").replace("Z", " UTC");
  const lines = [
    "📦 *Telegram Bridge MCP*",
    "",
    `*Version:* \`${MCP_VERSION}\``,
    `*Commit:* \`${_mcpCommit}\``,
    `*Built:* \`${buildTimeDisplay}\``,
  ];
  try {
    await getApi().sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// /shutdown — shuts down the MCP server from Telegram
// ---------------------------------------------------------------------------

function handleShutdownCommand(): void {
  stopPoller();
  const notifyShutdown = Promise.race([
    sendServiceMessage("⛔️ Shutting down…").catch(() => {}),
    new Promise<void>((r) => setTimeout(r, 5000)),
  ]);
  void notifyShutdown.finally(() => clearCommandsOnShutdown().finally(() => process.exit(0)));
}

// ---------------------------------------------------------------------------
// /session panel
// ---------------------------------------------------------------------------

async function handleSessionCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  const { text, keyboard } = buildSessionPanel();
  try {
    const msg = await api.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
    _activePanels.set(msg.message_id, "session");
  } catch { /* ignore */ }
}

async function handleSessionCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  // Ack the spinner immediately
  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }

  if (data === "session:dismiss") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  // ── Startup questionnaire — step 1 response ───────────────────────────
  if (data === "session:prefs:record") {
    // Advance to step 2 by editing the same message
    try {
      await api.editMessageText(chatId, panelMsgId, buildPrefsStep2Text(), {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buildPrefsStep2Keyboard() },
      });
    } catch { /* ignore */ }
    return;
  }

  if (data === "session:prefs:skip") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  // ── Startup questionnaire — step 2 response (auto-dump frequency) ─────
  if (data.startsWith("session:auto:")) {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    const val = data.slice("session:auto:".length);
    if (val !== "off" && val !== "never") {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) {
        startRecording(Math.max(n * 2, 100));
        setAutoDump(n, createAutoDumpFn(chatId, api));
      }
    } else if (val === "never") {
      // Record without auto-dump — large rolling buffer, manual dump via /session
      startRecording(500);
    }
    return;
  }

  if (data === "session:start") {
    startRecording(100);
  } else if (data === "session:stop") {
    stopRecording();
    clearRecording();
  } else if (data === "session:dump") {
    await doSessionDump(chatId, panelMsgId, api);
    return; // doSessionDump deletes the panel itself
  }

  // Refresh the panel with new state
  const { text, keyboard } = buildSessionPanel();
  try {
    await api.editMessageText(chatId, panelMsgId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch { /* ignore */ }
}

function createAutoDumpFn(chatId: number, api: ReturnType<typeof getApi>): () => Promise<void> {
  return async () => {
    await doSessionDump(chatId, null, api);
    clearRecording(); // keep recording + auto-dump active; reset buffer only
  };
}

function buildSessionPanel(): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const recording = isRecording();
  const count = recordedCount();
  const max = getMaxUpdates();
  const autoDump = getAutoDumpThreshold();

  const status = recording
    ? `🔴 Recording · ${count} / ${max} captured${autoDump != null ? ` · auto-dump @${autoDump}` : ""}`
    : `⬛ Not recording`;

  const text = `📼 *Session Recording*\nStatus: ${status}`;

  const keyboard = recording
    ? [
        [
          { text: "📤 Dump", callback_data: "session:dump" },
          { text: "⏹ Stop", callback_data: "session:stop" },
          { text: "✖ Dismiss", callback_data: "session:dismiss" },
        ],
      ]
    : [
        [
          { text: "▶ Start", callback_data: "session:start" },
          { text: "✖ Dismiss", callback_data: "session:dismiss" },
        ],
      ];

  return { text, keyboard };
}

async function doSessionDump(
  chatId: number,
  panelMsgId: number | null,
  api: ReturnType<typeof getApi>,
): Promise<void> {
  if (panelMsgId !== null) {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
  }

  const entries = getSessionEntries();
  const sanitized = await sanitizeSessionEntries(entries);

  // Build the log text inline (same format as dump_session_record)
  const now = new Date().toISOString();
  const lines: string[] = [
    "# Session Recording Log",
    `Generated: ${now}`,
    `Recording: ${isRecording() ? "active" : "inactive"}`,
    `Updates: ${entries.length} / ${getMaxUpdates()}`,
    "",
    "---",
    "",
  ];

  if (sanitized.length === 0) {
    lines.push("(no updates captured)");
  } else {
    sanitized.forEach((u, i) => {
      const str = (v: unknown, fallback = ""): string =>
        typeof v === "string" ? v
          : typeof v === "number" || typeof v === "boolean" ? String(v)
          : fallback;

      const from = str(u.from, "user");
      const fromLabel = from === "bot" ? "[BOT]" : "[USER]";
      const type = str(u.type, "unknown");
      const msgId = u.message_id != null ? `msg_id: ${str(u.message_id)}` : "";

      if (from === "bot") {
        lines.push(`[${i + 1}] ${fromLabel} ${str(u.content_type, "unknown")} | ${msgId}`);
        if (u.text) lines.push(str(u.text));
      } else if (type === "message") {
        lines.push(`[${i + 1}] ${fromLabel} message · ${str(u.content_type, "unknown")} | ${msgId}`);
        if (u.text) lines.push(str(u.text));
        if (u.caption) lines.push(`Caption: ${str(u.caption)}`);
        if (u.file_name) lines.push(`File: ${str(u.file_name)}`);
      } else if (type === "callback_query") {
        lines.push(`[${i + 1}] ${fromLabel} callback_query | ${msgId}`);
        if (u.data) lines.push(`data: ${str(u.data)}`);
      } else {
        lines.push(`[${i + 1}] ${fromLabel} ${type}`);
      }
      lines.push("");
    });
  }

  lines.push("---", "End of log");
  const logText = lines.join("\n");

  // Send as a .txt document if any content, else as a short message
  if (entries.length === 0) {
    try {
      await api.sendMessage(chatId, "📼 *Session Recording*\n_(no updates captured)_", {
        parse_mode: "Markdown",
      });
    } catch { /* ignore */ }
    return;
  }

  try {
    const { InputFile } = await import("grammy");
    const buf = Buffer.from(logText, "utf-8");
    const file = new InputFile(buf, `session-${now.replace(/[:.]/g, "-")}.txt`);
    await api.sendDocument(chatId, file, {
      caption: `📼 Session dump · ${entries.length} updates`,
    });
  } catch {
    // Fallback: send first 4000 chars as a message
    try {
      await api.sendMessage(chatId, `\`\`\`\n${logText.slice(0, 3900)}\n\`\`\``, {
        parse_mode: "Markdown",
      });
    } catch { /* ignore */ }
  }
}

/** For testing only: resets module-scoped state. */
export function resetBuiltInCommandsForTest(): void {
  _activePanels.clear();
  _sessionPrefsAsked = false;
}
