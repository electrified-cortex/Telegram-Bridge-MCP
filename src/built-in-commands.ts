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
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { getSessionLogMode, setSessionLogMode, sessionLogLabel } from "./config.js";

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
import { dumpTimeline, dumpTimelineSince, timelineSize, storeSize, setOnEvent } from "./message-store.js";

// ---------------------------------------------------------------------------
// Tracking panel message IDs so callback_query intercept can route back
// ---------------------------------------------------------------------------

/** Maps from message_id → panel type so we can route callback_queries back to us. */
const _activePanels = new Map<number, "session">();

/** Set to true after sending the startup prefs prompt so we only ask once per process. */
let _sessionPrefsAsked = false;

// ---------------------------------------------------------------------------
// Auto-dump state — tracks timeline events since last dump
// ---------------------------------------------------------------------------

let _autoDumpThreshold: number | null = null;
let _eventsSinceLastDump = 0;
let _dumpInFlight = false;
let _dumpCursor = 0;

/** Advance the dump cursor to the current end of timeline. Call after any external dump to prevent redundant re-dumps. */
export function advanceDumpCursor(): void {
  _dumpCursor = timelineSize();
}

/** Configure auto-dump: fire every `threshold` events (null to disable). */
export function setAutoDumpThreshold(threshold: number | null): void {
  _autoDumpThreshold = threshold;
  _eventsSinceLastDump = 0;
  if (threshold != null && threshold > 0) {
    setOnEvent((_size: number) => {
      _eventsSinceLastDump++;
      if (_autoDumpThreshold != null && _eventsSinceLastDump >= _autoDumpThreshold && !_dumpInFlight) {
        _dumpInFlight = true;
        _eventsSinceLastDump = 0;
        void doTimelineDump(true).finally(() => { _dumpInFlight = false; });
      }
    });
  } else {
    setOnEvent(null);
  }
}

/**
 * Apply session log mode from persistent config.
 * Wires up auto-dump if mode is a number; disables it otherwise.
 */
export function applySessionLogConfig(): void {
  const mode = getSessionLogMode();
  if (typeof mode === "number") {
    setAutoDumpThreshold(mode);
  } else {
    setAutoDumpThreshold(null);
  }
}

/** Current auto-dump threshold (null = disabled). */
export function getAutoDumpThresholdValue(): number | null {
  return _autoDumpThreshold;
}

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
 *
 * @deprecated Use the persistent config + /session panel instead.
 */
export function sendSessionPrefsPrompt(): void {
  if (_sessionPrefsAsked) return;
  _sessionPrefsAsked = true;
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
      if ((update.message.date) < _startupEpoch) {
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
  const shutdownSequence = (async () => {
    // Wait for the poll loop to finish (completes in-flight transcriptions)
    await waitForPollerExit();
    // Drain any updates received since the last poll iteration
    await drainPendingUpdates();
    // Dump session log before shutting down (if not disabled)
    if (getSessionLogMode() !== null) {
      try { await doTimelineDump(true); } catch { /* best effort */ }
    }
    await sendServiceMessage("⛔️ Shutting down…").catch(() => {});
  })();
  const timeout = new Promise<void>((r) => setTimeout(r, 10000));
  void Promise.race([shutdownSequence, timeout])
    .finally(() => clearCommandsOnShutdown().finally(() => process.exit(0)));
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

  // ── Mode switches ─────────────────────────────────────────────────────
  if (data === "session:disable") {
    setSessionLogMode(null);
    applySessionLogConfig();
  } else if (data === "session:manual") {
    setSessionLogMode("manual");
    applySessionLogConfig();
  } else if (data === "session:autodump") {
    // Show threshold picker
    try {
      await api.editMessageText(chatId, panelMsgId, "� *Auto-dump*\n\nDump the session record every N events:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [
            { text: "10", callback_data: "session:setauto:10" },
            { text: "25", callback_data: "session:setauto:25" },
            { text: "50", callback_data: "session:setauto:50" },
            { text: "100", callback_data: "session:setauto:100" },
          ],
          [{ text: "✖ Cancel", callback_data: "session:dismiss" }],
        ] },
      });
    } catch { /* ignore */ }
    return;
  } else if (data.startsWith("session:setauto:")) {
    const n = parseInt(data.slice("session:setauto:".length), 10);
    if (!isNaN(n) && n > 0) {
      setSessionLogMode(n);
      applySessionLogConfig();
    }
  } else if (data === "session:dump") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    await doTimelineDump(true);
    return;
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

// ---------------------------------------------------------------------------
// Timeline dump — JSON file sent to Telegram
// ---------------------------------------------------------------------------

/**
 * Take a snapshot of the message-store timeline, convert to JSON, and send
 * as a .json file to Telegram. Used by both manual (/session → Dump) and
 * auto-dump (threshold reached).
 *
 * @param incremental If true, only dump events since last dump (cursor-based).
 *                    If false (default), dump the full timeline.
 */
export async function doTimelineDump(incremental = false): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  let timeline: Array<Record<string, unknown>>;
  if (incremental) {
    const result = dumpTimelineSince(_dumpCursor);
    timeline = result.events;
    _dumpCursor = result.nextCursor;
  } else {
    timeline = dumpTimeline();
    _dumpCursor = timelineSize();
  }

  if (timeline.length === 0) {
    if (!incremental) {
      try {
        await api.sendMessage(chatId, "� *Session Record*\n_(no events captured)_", {
          parse_mode: "Markdown",
        });
      } catch { /* ignore */ }
    }
    return;
  }

  const now = new Date().toISOString();
  const payload = {
    generated: now,
    incremental,
    event_count: timeline.length,
    total_timeline: timelineSize(),
    unique_messages: storeSize(),
    timeline,
  };

  try {
    const { InputFile } = await import("grammy");
    const buf = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
    const file = new InputFile(buf, `session-log-${now.replace(/[:.]/g, "-")}.json`);
    const label = `� Session record · ${timeline.length} events${incremental ? " (incremental)" : ""}`;
    const msg = await api.sendDocument(chatId, file, { caption: label }) as {
      message_id: number;
      document?: { file_id?: string };
    };

    // Amend caption with file_id so it's recoverable after a crash
    const fileId = msg.document?.file_id;
    if (fileId) {
      try {
        await api.editMessageCaption(chatId, msg.message_id, {
          caption: `${label}\nFile ID: \`${fileId}\``,
          parse_mode: "Markdown",
        });
      } catch { /* best effort */ }
    }
  } catch {
    // Fallback: truncated message
    try {
      const json = JSON.stringify(payload);
      await api.sendMessage(chatId, `\`\`\`json\n${json.slice(0, 3900)}\n\`\`\``, {
        parse_mode: "Markdown",
      });
    } catch { /* ignore */ }
  }
}

function buildSessionPanel(): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const tSize = timelineSize();
  const mSize = storeSize();
  const mode = getSessionLogMode();

  const lines = [
    `� *Session Record*`,
    `Mode: ${sessionLogLabel()}`,
    `Timeline: ${tSize} events · ${mSize} messages`,
  ];
  if (typeof mode === "number") {
    lines.push(`Auto-dump: every ${mode} events (${_eventsSinceLastDump} since last)`);
  }

  const text = lines.join("\n");

  // Row 1: mode switches
  const modeButtons: { text: string; callback_data: string }[] = [];
  if (mode !== null) {
    modeButtons.push({ text: "⏹ Disable", callback_data: "session:disable" });
  }
  if (mode !== "manual") {
    modeButtons.push({ text: "✋ Manual", callback_data: "session:manual" });
  }
  if (typeof mode !== "number") {
    modeButtons.push({ text: "⏩ Auto-dump", callback_data: "session:autodump" });
  } else {
    modeButtons.push({ text: `⏩ Auto (${mode})`, callback_data: "session:autodump" });
  }

  // Row 2: actions
  const actionButtons: { text: string; callback_data: string }[] = [];
  if (mode !== null && tSize > 0) {
    actionButtons.push({ text: "\uD83D\uDDD2 Dump record", callback_data: "session:dump" });
  }
  actionButtons.push({ text: "✖ Dismiss", callback_data: "session:dismiss" });

  const keyboard = [modeButtons, actionButtons];

  return { text, keyboard };
}

/** For testing only: resets module-scoped state. */
export function resetBuiltInCommandsForTest(): void {
  _activePanels.clear();
  _sessionPrefsAsked = false;
  setAutoDumpThreshold(null);
  _dumpCursor = 0;
}
