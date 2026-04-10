/**
 * Built-in server-level slash commands.
 *
 * These commands are intercepted in the update pipeline *before* any update
 * is delivered to the agent via dequeue. The agent never
 * sees them — the server handles them directly and responds to the user.
 *
 * Currently registered:
 *   /logging  — shows a logging control panel
 *
 * The server registers these in the Telegram command menu on startup so they
 * always appear in autocomplete regardless of what the agent has registered.
 */

import { createRequire } from "module";
import type { Update } from "grammy/types";
import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { rollLog, isLoggingEnabled, enableLogging, disableLogging, listLogs, getCurrentLogFilename, deleteLog } from "./local-log.js";
import { elegantShutdown, setShutdownDumpHook } from "./shutdown.js";

import { getSessionLogMode } from "./config.js";
import { getDefaultVoice, setDefaultVoice, getConfiguredVoices } from "./config.js";
import type { VoiceEntry } from "./config.js";
import { fetchVoiceList, isTtsEnabled } from "./tts.js";
import { getSessionSpeed } from "./voice-state.js";
import { activateAutoApproveOne, activateAutoApproveTimed, cancelAutoApprove, getAutoApproveState } from "./auto-approve.js";
import { isDelegationEnabled, setDelegationEnabled } from "./agent-approval.js";


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
import type { TimelineEvent } from "./message-store.js";
import { timelineSize, setOnEvent } from "./message-store.js";
import { listSessions } from "./session-manager.js";
import { getGovernorSid, setGovernorSid } from "./routing-mode.js";
import { deliverServiceMessage } from "./session-queue.js";
import { getCallerSid, runInSessionContext } from "./session-context.js";
import { closeSessionById } from "./session-teardown.js";

// ---------------------------------------------------------------------------
// Tracking panel message IDs so callback_query intercept can route back
// ---------------------------------------------------------------------------

/** Maps from message_id → panel type so we can route callback_queries back to us. */
const _activePanels = new Map<number, "logging" | "voice" | "voice-sample" | "approval" | "governor" | "approve" | "session" | "log">();

// ---------------------------------------------------------------------------
// Operator approval gate — system-level confirmation for sensitive tool calls
// ---------------------------------------------------------------------------

/** Pending approval callbacks, indexed by the approval button message_id. */
const _pendingApprovals = new Map<number, (approved: boolean) => void>();

/**
 * Send an inline keyboard to the operator asking for approval, and block
 * until the operator responds (or the timeout expires).
 *
 * @param prompt  Markdown text describing what is being approved.
 * @param timeoutMs  How long to wait before auto-denying (default: 60 s).
 * @returns "approved" | "denied" | "timed_out"
 */
export async function requestOperatorApproval(
  prompt: string,
  timeoutMs = 60_000,
): Promise<"approved" | "denied" | "timed_out" | "send_failed"> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return "send_failed";
  const api = getApi();
  const callerSid = getCallerSid();

  let msg: { message_id: number };
  try {
    msg = await api.sendMessage(chatId, prompt, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: "approval:approve" },
          { text: "❌ Deny",    callback_data: "approval:deny"    },
        ]],
      },
    });
  } catch {
    return "send_failed";
  }

  markInternalMessage(msg.message_id);
  _activePanels.set(msg.message_id, "approval");

  return new Promise<"approved" | "denied" | "timed_out">((resolve) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(msg.message_id);
      _activePanels.delete(msg.message_id);
      void runInSessionContext(callerSid, () =>
        api.editMessageText(chatId, msg.message_id, `${prompt}\n\n_⏱ Timed out_`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        })
      ).catch(() => {/* non-fatal */});
      resolve("timed_out");
    }, timeoutMs);

    _pendingApprovals.set(msg.message_id, (approved) => {
      clearTimeout(timer);
      _activePanels.delete(msg.message_id);
      const suffix = approved ? "\n\n▸ ✅ *Approved*" : "\n\n▸ ❌ *Denied*";
      void runInSessionContext(callerSid, () =>
        api.editMessageText(chatId, msg.message_id, `${prompt}${suffix}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        })
      ).catch(() => {/* non-fatal */});
      resolve(approved ? "approved" : "denied");
    });
  });
}

async function handleApprovalCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  try { await getApi().answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }
  const resolve = _pendingApprovals.get(panelMsgId);
  if (resolve) {
    _pendingApprovals.delete(panelMsgId);
    resolve(data === "approval:approve");
  }
}

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
        doTimelineDump(true);
        _dumpInFlight = false;
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

// Wire up the session-log dump hook for elegant shutdown (avoids circular import)
setShutdownDumpHook(() => {
  if (getSessionLogMode() !== null) {
    doTimelineDump(true);
  }
  return Promise.resolve();
});

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
  { command: "logging", description: "Logging controls" },
  { command: "voice", description: "Change the TTS voice" },
  { command: "version", description: "Show server version and build info" },
  { command: "shutdown", description: "Shut down the MCP server" },
  { command: "approve", description: "Pre-approve session requests" },
  { command: "session", description: "Manage active sessions" },
  { command: "log", description: "Session recording controls" },
] as const;

const _builtInCommandNames = new Set<string>([...BUILT_IN_COMMANDS.map(c => c.command), "primary"]);

/**
 * Message IDs for bot-sent session infrastructure messages (panel, dump docs,
 * notices) that should be excluded from the session record dump.
 * The events still appear in the timeline and flow through dequeue —
 * they just shouldn't show up when recording the session.
 */
const _internalMessageIds = new Set<number>();

/** Register a bot-sent message as internal so it is skipped in record dumps. */
export function markInternalMessage(messageId: number): void {
  _internalMessageIds.add(messageId);
}

/**
 * Returns true if a timeline event is an internal server event (built-in
 * slash command, session-panel callback, or bot-sent session infrastructure
 * message) that should be excluded from the session record dump. The event
 * is still stored in the timeline and visible to dequeue — it just
 * shouldn't pollute the record.
 */
export function isInternalTimelineEvent(evt: Omit<TimelineEvent, "_update">): boolean {
  if (_internalMessageIds.has(evt.id)) return true;
  if (evt.event === "message" && evt.content.type === "command") {
    return _builtInCommandNames.has(evt.content.text ?? "");
  }
  if (evt.event === "callback" && typeof evt.content.data === "string") {
    return (
      evt.content.data.startsWith("logging:") ||
      evt.content.data.startsWith("voice:") ||
      evt.content.data.startsWith("approval:") ||
      evt.content.data.startsWith("approve:") ||
      evt.content.data.startsWith("governor:") ||
      evt.content.data.startsWith("session:") ||
      evt.content.data.startsWith("log:")
    );
  }
  return false;
}

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
      if (raw === "logging") {
        await handleLoggingCommand();
        return true;
      }
      if (raw === "voice") {
        await handleVoiceCommand();
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
      if (raw === "primary") {
        await handleGovernorCommand();
        return true;
      }
      if (raw === "approve") {
        await handleApproveCommand();
        return true;
      }
      if (raw === "session") {
        await handleSessionCommand();
        return true;
      }
      if (raw === "log") {
        await handleLogCommand();
        return true;
      }
    }
  }

  // ── Callback query for a built-in panel ────────────────────────────────
  if (update.callback_query) {
    const msgId = update.callback_query.message?.message_id;
    if (msgId !== undefined && _activePanels.has(msgId)) {
      const panelType = _activePanels.get(msgId);
      if (panelType === "voice") {
        await handleVoiceCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "voice-sample") {
        await handleVoiceSampleCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "approval") {
        await handleApprovalCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "governor") {
        await handleGovernorCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "approve") {
        await handleApproveCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "logging") {
        await handleLoggingCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "session") {
        await handleSessionCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      } else if (panelType === "log") {
        await handleLogCallback(
          update.callback_query.id,
          msgId,
          update.callback_query.data ?? "",
        );
      }
      return true;
    }

    // Expired callback — panel no longer active but button was pressed late
    const data = update.callback_query.data ?? "";
    if (data.startsWith("approval:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This approval has expired." }); } catch { /* ignore */ }
      return true;
    }
    if (data.startsWith("governor:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This panel has expired." }); } catch { /* ignore */ }
      return true;
    }
    if (data.startsWith("approve:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This panel has expired." }); } catch { /* ignore */ }
      return true;
    }
    if (data.startsWith("logging:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This panel has expired." }); } catch { /* ignore */ }
      return true;
    }
    if (data.startsWith("session:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This panel has expired." }); } catch { /* ignore */ }
      return true;
    }
    if (data.startsWith("log:")) {
      try { await getApi().answerCallbackQuery(update.callback_query.id, { text: "This panel has expired." }); } catch { /* ignore */ }
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// /governor panel — runtime governor selection
// ---------------------------------------------------------------------------

/**
 * Returns the /primary command entry if 2+ sessions are active, null otherwise.
 * Since /session now bundles primary selection, /primary is kept functional for
 * backward compatibility but is no longer added to the Telegram command menu.
 */
export function getGovernorCommandEntry(): { command: string; description: string } | null {
  return null;
}

/**
 * Update the Telegram command menu to show or hide /governor based on
 * whether 2+ sessions are active. Call after session creation and closure.
 * Best-effort: returns true on success, false on failure.
 */
export function refreshGovernorCommand(): Promise<boolean> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return Promise.resolve(false);

  const api = getApi();
  return api
    .getMyCommands({ scope: { type: "chat", chat_id: chatId } })
    .then(existingCommands => {
      // Strip built-ins and /primary — they'll be re-added below
      const custom = existingCommands.filter(
        cmd => cmd.command !== "primary" && !BUILT_IN_COMMANDS.some(b => b.command === cmd.command),
      );

      const merged: { command: string; description: string }[] = [...BUILT_IN_COMMANDS];
      const govEntry = getGovernorCommandEntry();
      if (govEntry) merged.push(govEntry);
      merged.push(...custom);

      return api.setMyCommands(merged, { scope: { type: "chat", chat_id: chatId } });
    })
    .then(() => true, () => false);
}

async function handleGovernorCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  const sessions = listSessions();
  if (sessions.length < 2) {
    try {
      const msg = await api.sendMessage(chatId, "ℹ️ Primary selection requires 2 or more active sessions.");
      markInternalMessage(msg.message_id);
    } catch { /* ignore */ }
    return;
  }

  const { text, keyboard } = buildGovernorPanel(sessions);
  try {
    const msg = await api.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: keyboard },
    });
    _activePanels.set(msg.message_id, "governor");
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

async function handleGovernorCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }

  if (data === "governor:dismiss") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  if (data.startsWith("governor:set:")) {
    const newSid = parseInt(data.slice("governor:set:".length), 10);
    if (isNaN(newSid)) return;

    const sessions = listSessions();

    // Guard: refuse primary changes when < 2 sessions (panel may be stale)
    if (sessions.length < 2) {
      _activePanels.delete(panelMsgId);
      try {
        await runInSessionContext(0, () => api.editMessageText(
          chatId,
          panelMsgId,
          "ℹ️ Primary selection requires 2 or more active sessions.",
          { reply_markup: { inline_keyboard: [] } },
        ));
      } catch { /* ignore */ }
      return;
    }

    const newGovernor = sessions.find(s => s.sid === newSid);
    if (!newGovernor) {
      _activePanels.delete(panelMsgId);
      try {
        await runInSessionContext(0, () => api.editMessageText(
          chatId,
          panelMsgId,
          "⚠️ The selected session is no longer active. Please reopen /primary to choose from the current list.",
          { reply_markup: { inline_keyboard: [] } },
        ));
      } catch { /* ignore */ }
      return;
    }

    const oldSid = getGovernorSid();

    // No-op if selecting the already-current governor
    if (newSid === oldSid) {
      _activePanels.delete(panelMsgId);
      try {
        await runInSessionContext(0, () => api.editMessageText(
          chatId,
          panelMsgId,
          `${buildGovernorPanel(sessions).text}\n\n▸ ${newGovernor.color} ${newGovernor.name} is already the primary.`,
          { reply_markup: { inline_keyboard: [] } },
        ));
      } catch { /* ignore */ }
      return;
    }

    setGovernorSid(newSid);

    const newLabel = `${newGovernor.color} ${newGovernor.name}`;

    // Broadcast to Telegram chat: visible operator-facing announcement
    sendServiceMessage(`🔀 ${newLabel} is now the primary session.`).catch(() => {});

    // Notify new governor
    deliverServiceMessage(
      newSid,
      `You are now the governor. Ambiguous messages will be routed to you.`,
      "governor_changed",
      { old_governor_sid: oldSid, new_governor_sid: newSid },
    );

    // Notify old governor if different
    if (oldSid > 0 && oldSid !== newSid) {
      const oldGovernor = sessions.find(s => s.sid === oldSid);
      if (oldGovernor) {
        deliverServiceMessage(
          oldSid,
          `You are no longer the governor. ${newLabel} is now the governor.`,
          "governor_changed",
          { old_governor_sid: oldSid, new_governor_sid: newSid },
        );
      }
    }

    // Notify all other sessions
    for (const s of sessions) {
      if (s.sid === newSid || s.sid === oldSid) continue;
      deliverServiceMessage(
        s.sid,
        `Governor changed: ${newLabel} is now the governor.`,
        "governor_changed",
        { old_governor_sid: oldSid, new_governor_sid: newSid },
      );
    }

    // Confirm selection in the panel message and close it
    _activePanels.delete(panelMsgId);
    try {
      await runInSessionContext(0, () => api.editMessageText(
        chatId,
        panelMsgId,
        `${buildGovernorPanel(sessions).text}\n\n▸ ✅ Primary set to ${newLabel}`,
        { reply_markup: { inline_keyboard: [] } },
      ));
    } catch { /* ignore */ }
  }
}

function buildGovernorPanel(
  sessions: Array<{ sid: number; name: string; color: string }>,
): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const currentSid = getGovernorSid();
  const text =
    "The primary session receives ambiguous messages and decides how to route them. " +
    "Choose which session should be the primary:";
  const keyboard: { text: string; callback_data: string }[][] = [];
  for (const s of sessions) {
    const isGov = s.sid === currentSid;
    const label = `${s.color} ${s.name}${isGov ? " ✓" : ""}`;
    keyboard.push([{ text: label, callback_data: `governor:set:${s.sid}` }]);
  }
  keyboard.push([{ text: "✖ Dismiss", callback_data: "governor:dismiss" }]);
  return { text, keyboard };
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
    const msg = await getApi().sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// /shutdown — shuts down the MCP server from Telegram
// ---------------------------------------------------------------------------

function handleShutdownCommand(): void {
  void elegantShutdown();
}

// ---------------------------------------------------------------------------
// /voice panel
// ---------------------------------------------------------------------------

/**
 * Resolve available voice names.
 *
 * Priority: configured voices in mcp-config.json → remote fetch from TTS
 * server → empty (TTS not available or no listing endpoint).
 */
async function resolveVoiceNames(): Promise<VoiceEntry[]> {
  const configured = getConfiguredVoices();
  if (configured.length > 0) return configured;

  const remote = await fetchVoiceList();
  if (remote.length > 0) return remote;
  return [];
}

async function handleVoiceCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  if (!isTtsEnabled()) {
    try {
      const msg = await api.sendMessage(
        chatId,
        "🔇 TTS is not configured. Set `TTS_HOST` or `OPENAI_API_KEY` to enable voice.",
        { parse_mode: "Markdown" },
      );
      markInternalMessage(msg.message_id);
    } catch { /* ignore */ }
    return;
  }

  const { text, keyboard } = await buildVoicePanel();
  try {
    const msg = await api.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
    _activePanels.set(msg.message_id, "voice");
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

async function handleVoiceCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }

  if (data === "voice:dismiss") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  if (data === "voice:noop") return;

  // Wizard navigation — extract the step from callback data
  let step = "";
  if (data === "voice:clear") {
    setDefaultVoice(null);
  } else if (data === "voice:home") {
    step = "";
  } else if (data.startsWith("voice:nav:")) {
    step = data.slice("voice:nav:".length);
  } else if (data.startsWith("voice:sample:")) {
    const voiceName = data.slice("voice:sample:".length);
    await sendVoiceSample(chatId, voiceName);
  }

  // Refresh panel at the current wizard step
  const { text, keyboard } = await buildVoicePanel(step);
  try {
    await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    }));
  } catch { /* ignore */ }
}

async function sendVoiceSample(
  chatId: number,
  voiceName: string,
): Promise<void> {
  const { synthesizeToOgg: synthOgg } = await import("./tts.js");
  const voices = await resolveVoiceNames();
  const entry = voices.find(v => v.name === voiceName);
  const displayName = voiceLabel(entry ?? { name: voiceName });
  const sampleText =
    `Hi, this is a sample of the ${displayName} voice. ` +
    "Hopefully it sounds good to you!";
  try {
    const resolvedSpeed = getSessionSpeed() ?? undefined;
    const ogg = await synthOgg(sampleText, voiceName, resolvedSpeed);
    const { sendVoiceDirect: sendVoice } = await import("./telegram.js");
    const msg = await sendVoice(chatId, ogg, {
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [[{
          text: `🎧 Use ${displayName} voice`,
          callback_data: `voice:set:${voiceName}`,
        }]],
      },
    });
    markInternalMessage(msg.message_id);
    _activePanels.set(msg.message_id, "voice-sample");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      const api = getApi();
      const msg = await api.sendMessage(
        chatId,
        `⚠️ Failed to generate sample for ${voiceName}: ${errMsg}`,
      );
      markInternalMessage(msg.message_id);
    } catch { /* ignore */ }
  }
}

/**
 * Handles a callback from the "Use this voice" button on a voice sample.
 * Sets the default voice and confirms via callback toast.
 */
async function handleVoiceSampleCallback(
  callbackQueryId: string,
  sampleMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  if (!data.startsWith("voice:set:")) {
    try { await api.answerCallbackQuery(callbackQueryId); }
    catch { /* ignore */ }
    return;
  }

  const voiceName = data.slice("voice:set:".length);
  setDefaultVoice(voiceName);
  _activePanels.delete(sampleMsgId);

  try {
    await api.answerCallbackQuery(callbackQueryId, {
      text: `Voice set to ${voiceName}`,
    });
  } catch { /* ignore */ }
}

type InlineButton = { text: string; callback_data: string };

/** Display label for a voice entry. */
function voiceLabel(v: VoiceEntry): string {
  return v.description ?? v.name;
}

/** Human-readable labels for language codes. */
const LANG_LABELS: Record<string, string> = {
  "en-US": "🇺🇸 American",
  "en-GB": "🇬🇧 British",
};

/** Human-readable labels for genders. */
const GENDER_LABELS: Record<string, string> = {
  male: "♂ Male",
  female: "♀ Female",
};

function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? lang;
}

function genderLabel(g: string): string {
  return GENDER_LABELS[g] ?? g;
}

/**
 * Wizard-style voice panel.
 *
 * Step encoding (empty string = home):
 *   ""             → show language buttons
 *   "en-US"        → show gender buttons for that language
 *   "en-US:female" → show individual voices
 */
async function buildVoicePanel(
  step = "",
): Promise<{
  text: string;
  keyboard: InlineButton[][];
}> {
  const currentVoice = getDefaultVoice();
  const envVoice = process.env.TTS_VOICE;
  const effective = currentVoice ?? envVoice ?? "(provider default)";

  const lines = [
    "🎙 *Voice Selection*",
    "",
    `*Current:* \`${effective}\``,
  ];
  if (currentVoice) {
    lines.push(`*Source:* config override`);
  } else if (envVoice) {
    lines.push(`*Source:* TTS\\_VOICE env var`);
  }

  const voices = await resolveVoiceNames();
  const keyboard: InlineButton[][] = [];

  if (voices.length === 0) {
    lines.push("");
    lines.push(
      "_No voices found — TTS still works with the " +
      "built\\-in voice\\. Point `TTS\\_HOST` at a " +
      "[Kokoro](https://github.com/hexgrad/kokoro) " +
      "server for 25\\+ natural voices\\._"
    );
  } else {
    buildWizardStep(voices, keyboard, lines, step, effective);
  }

  // Footer row
  const footerRow: InlineButton[] = [];
  if (step) {
    const backStep = step.includes(":")
      ? step.slice(0, step.indexOf(":"))
      : "";
    const backData = backStep
      ? `voice:nav:${backStep}`
      : "voice:home";
    footerRow.push({ text: "↩ Back", callback_data: backData });
  }
  if (currentVoice) {
    footerRow.push({
      text: "↩ Reset",
      callback_data: "voice:clear",
    });
  }
  footerRow.push({
    text: "✖ Dismiss",
    callback_data: "voice:dismiss",
  });
  keyboard.push(footerRow);

  return { text: lines.join("\n"), keyboard };
}

/** Populate the wizard keyboard and text lines for the given step. */
function buildWizardStep(
  voices: VoiceEntry[],
  keyboard: InlineButton[][],
  lines: string[],
  step: string,
  effective: string,
): void {
  // Collect unique languages
  const langs = [...new Set(
    voices.map(v => v.language).filter(Boolean)
  )] as string[];

  // No language metadata → flat list (fallback)
  if (langs.length === 0) {
    lines.push("");
    lines.push("Tap a voice to hear a sample:");
    buildFlatVoiceButtons(voices, keyboard, effective);
    return;
  }

  if (!step) {
    // Step 1: pick language
    lines.push("");
    lines.push("Pick a language:");
    for (const lang of langs) {
      keyboard.push([{
        text: langLabel(lang),
        callback_data: `voice:nav:${lang}`,
      }]);
    }
    return;
  }

  const parts = step.split(":");
  const selectedLang = parts[0];
  const selectedGender = parts[1] ?? "";
  const langVoices = voices.filter(
    v => v.language === selectedLang
  );

  if (!selectedGender) {
    // Step 2: pick gender within the language
    const genders = [...new Set(
      langVoices.map(v => v.gender).filter(Boolean)
    )] as string[];

    if (genders.length <= 1) {
      // Only one gender — skip straight to voices
      lines.push("");
      lines.push(
        `${langLabel(selectedLang)} — ` +
        "tap a voice to hear a sample:"
      );
      buildFlatVoiceButtons(langVoices, keyboard, effective);
      return;
    }

    lines.push("");
    lines.push(`${langLabel(selectedLang)} — pick a category:`);
    for (const g of genders) {
      keyboard.push([{
        text: genderLabel(g),
        callback_data: `voice:nav:${selectedLang}:${g}`,
      }]);
    }
    return;
  }

  // Step 3: show voices in language + gender
  const filtered = langVoices.filter(
    v => v.gender === selectedGender
  );
  lines.push("");
  lines.push(
    `${langLabel(selectedLang)} ${genderLabel(selectedGender)} — ` +
    "tap to hear a sample:"
  );
  buildFlatVoiceButtons(filtered, keyboard, effective);
}

/** Build a flat list of voice buttons (no grouping). */
function buildFlatVoiceButtons(
  voices: VoiceEntry[],
  keyboard: InlineButton[][],
  effective: string,
): void {
  const buttonsPerRow = 3;
  let row: InlineButton[] = [];
  for (const v of voices) {
    const isActive = v.name === effective;
    const label = isActive
      ? `✓ ${voiceLabel(v)}`
      : voiceLabel(v);
    row.push({
      text: label,
      callback_data: `voice:sample:${v.name}`,
    });
    if (row.length >= buttonsPerRow) {
      keyboard.push(row);
      row = [];
    }
  }
  if (row.length > 0) keyboard.push(row);
}

// ---------------------------------------------------------------------------
// /approve — auto-approve session requests
// ---------------------------------------------------------------------------

const AUTO_APPROVE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

async function handleApproveCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  const state = getAutoApproveState();
  let statusLine: string;
  if (state.mode === "one") {
    statusLine = "🟡 Auto-approve: next request only";
  } else if (state.mode === "timed" && state.expiresAt !== undefined) {
    const remaining = Math.ceil((state.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) {
      statusLine = "⚪ Auto-approve: off";
    } else {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      statusLine = `🟢 Auto-approve active (${mins}m ${secs}s remaining)`;
    }
  } else {
    statusLine = "⚪ Auto-approve: off";
  }

  let msg: { message_id: number };
  try {
    msg = await api.sendMessage(chatId, `*Session Auto-Approve*\n${statusLine}`, {
      parse_mode: "Markdown",
      _skipHeader: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🟡 Next request", callback_data: "approve:one" },
            { text: "🟢 10 minutes",   callback_data: "approve:timed" },
            { text: "✖ Dismiss",       callback_data: "approve:dismiss" },
          ],
          [
            isDelegationEnabled()
              ? { text: "🤝 Disable Delegation", callback_data: "approve:delegate:off" }
              : { text: "🤝 Enable Delegation",  callback_data: "approve:delegate:on" },
          ],
        ],
      },
    } as Record<string, unknown>);
  } catch { return; }

  markInternalMessage(msg.message_id);
  _activePanels.set(msg.message_id, "approve");
}

async function handleApproveCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }
  _activePanels.delete(panelMsgId);

  if (data === "approve:one") {
    activateAutoApproveOne();
    await api.editMessageText(chatId, panelMsgId,
      "*Session Auto-Approve → Next Request*",
      { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>
    ).catch(() => {/* non-fatal */});
  } else if (data === "approve:timed") {
    activateAutoApproveTimed(AUTO_APPROVE_DURATION_MS);
    const expiresMs = Date.now() + AUTO_APPROVE_DURATION_MS;
    const d = new Date(expiresMs);
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    await api.editMessageText(chatId, panelMsgId,
      `*Session Auto-Approve → 10 Minutes (expires ${hhmm})*`,
      { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>
    ).catch(() => {/* non-fatal */});
  } else if (data === "approve:delegate:on") {
    setDelegationEnabled(true);
    await api.editMessageText(chatId, panelMsgId,
      "*Session Auto-Approve → Delegation Enabled*",
      { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>
    ).catch(() => {/* non-fatal */});
  } else if (data === "approve:delegate:off") {
    setDelegationEnabled(false);
    await api.editMessageText(chatId, panelMsgId,
      "*Session Auto-Approve → Delegation Disabled*",
      { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>
    ).catch(() => {/* non-fatal */});
  } else {
    // dismiss — cancel any active auto-approve and close panel
    cancelAutoApprove();
    await api.editMessageText(chatId, panelMsgId,
      "*Session Auto-Approve → Dismissed*",
      { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>
    ).catch(() => {/* non-fatal */});
  }
}

// ---------------------------------------------------------------------------
// /logging panel
// ---------------------------------------------------------------------------

async function handleLoggingCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  const { text, keyboard } = buildLoggingPanel();
  try {
    const msg = await api.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      _skipHeader: true,
      reply_markup: { inline_keyboard: keyboard },
    } as Record<string, unknown>);
    _activePanels.set(msg.message_id, "logging");
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

async function handleLoggingCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }

  if (data === "logging:dismiss") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  if (data === "logging:on") {
    enableLogging();
  } else if (data === "logging:off") {
    // Auto-roll before disabling
    doTimelineDump();
    disableLogging();
  } else if (data === "logging:dump") {
    doTimelineDump();
  } else if (data === "logging:flush") {
    // Show destructive confirmation
    try {
      const archivedCount = listLogs().length;
      if (archivedCount === 0) {
        await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId,
          "ℹ️ No archived logs to flush.", { parse_mode: "Markdown", _skipHeader: true,
            reply_markup: { inline_keyboard: [[{ text: "✖ Dismiss", callback_data: "logging:dismiss" }]] } } as Record<string, unknown>));
      } else {
        await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId,
          `⚠️ *Delete all ${archivedCount} archived log(s)?*\n\nThe active log is untouched.`, {
            parse_mode: "Markdown", _skipHeader: true,
            reply_markup: { inline_keyboard: [
              [
                { text: "No — Cancel", callback_data: "logging:flush-cancel" },
                { text: "Delete All", callback_data: "logging:flush-confirm" },
              ],
            ]},
          } as Record<string, unknown>));
      }
    } catch { /* ignore */ }
    return;
  } else if (data === "logging:flush-cancel") {
    // Just refresh the panel
  } else if (data === "logging:flush-confirm") {
    // Delete all archived logs
    for (const filename of listLogs()) {
      try { deleteLog(filename); } catch { /* ignore */ }
    }
  }

  // Refresh panel
  const { text, keyboard } = buildLoggingPanel();
  try {
    await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId, text, {
      parse_mode: "Markdown", _skipHeader: true,
      reply_markup: { inline_keyboard: keyboard },
    } as Record<string, unknown>));
  } catch { /* ignore */ }
}

function buildLoggingPanel(): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const enabled = isLoggingEnabled();
  const archived = listLogs();
  const current = getCurrentLogFilename();

  const lines = [
    `📋 *Logging*`,
    `Status: ${enabled ? "On" : "Off"}`,
  ];
  if (current) lines.push(`Active: \`${current}\``);
  if (archived.length > 0) {
    const MAX_SHOWN = 5;
    const shown = archived.slice(-MAX_SHOWN);
    const rest = archived.length - shown.length;
    const fileList = shown.map(f => `\`${f}\``).join(", ");
    lines.push(`Archived: ${fileList}${rest > 0 ? ` (+${rest} more)` : ""}`);
  } else {
    lines.push(`No archived logs.`);
  }
  const text = lines.join("\n");

  if (!enabled) {
    // Logging OFF state
    const keyboard = [
      [
        { text: "On", callback_data: "logging:on" },
        { text: "✖ Dismiss", callback_data: "logging:dismiss" },
      ],
    ];
    return { text, keyboard };
  }

  // Logging ON state
  const flushLabel = `Flush (${archived.length})`;
  const keyboard = [
    [
      { text: "Dump", callback_data: "logging:dump" },
      { text: "Off", callback_data: "logging:off" },
      { text: flushLabel, callback_data: "logging:flush" },
      { text: "✖ Dismiss", callback_data: "logging:dismiss" },
    ],
  ];
  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// /session panel — fleet management UI
// ---------------------------------------------------------------------------

async function handleSessionCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  const sessions = listSessions();
  if (sessions.length === 0) {
    try {
      const msg = await api.sendMessage(chatId, "ℹ️ No active sessions.");
      markInternalMessage(msg.message_id);
    } catch { /* ignore */ }
    return;
  }

  const { text, keyboard } = buildSessionListPanel(sessions);
  try {
    const msg = await api.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: keyboard },
    });
    _activePanels.set(msg.message_id, "session");
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

function buildSessionListPanel(
  sessions: Array<{ sid: number; name: string; color: string }>,
): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const text = "Active sessions — tap one to manage:";
  const keyboard: { text: string; callback_data: string }[][] = [];
  for (const s of sessions) {
    const label = `${s.color} ${s.name} (SID ${s.sid})`;
    keyboard.push([{ text: label, callback_data: `session:select:${s.sid}` }]);
  }
  keyboard.push([{ text: "✖ Cancel", callback_data: "session:cancel" }]);
  return { text, keyboard };
}

async function handleSessionCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }

  if (data === "session:cancel") {
    _activePanels.delete(panelMsgId);
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
    return;
  }

  if (data === "session:back") {
    const sessions = listSessions();
    if (sessions.length === 0) {
      _activePanels.delete(panelMsgId);
      try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
      return;
    }
    const { text, keyboard } = buildSessionListPanel(sessions);
    try {
      await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId, text, {
        reply_markup: { inline_keyboard: keyboard },
      }));
    } catch { /* ignore */ }
    return;
  }

  if (data.startsWith("session:select:")) {
    const sid = parseInt(data.slice("session:select:".length), 10);
    if (isNaN(sid)) return;
    await renderSessionDetail(chatId, panelMsgId, sid);
    return;
  }

  if (data.startsWith("session:close:") && !data.startsWith("session:close_confirm:") && !data.startsWith("session:close_cancel:")) {
    const sid = parseInt(data.slice("session:close:".length), 10);
    if (isNaN(sid)) return;
    const sessions = listSessions();
    const target = sessions.find(s => s.sid === sid);
    const targetName = target?.name || `Session ${sid}`;
    try {
      await runInSessionContext(0, () => api.editMessageText(
        chatId,
        panelMsgId,
        `⚠️ Close *${targetName}* (SID ${sid})? This cannot be undone.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes, close it", callback_data: `session:close_confirm:${sid}` },
                { text: "✖ Cancel", callback_data: `session:close_cancel:${sid}` },
              ],
            ],
          },
        },
      ));
    } catch { /* ignore */ }
    return;
  }

  if (data.startsWith("session:close_confirm:")) {
    const sid = parseInt(data.slice("session:close_confirm:".length), 10);
    if (isNaN(sid)) return;
    _activePanels.delete(panelMsgId);
    const closeResult = closeSessionById(sid);
    const closeMsg = closeResult.closed
      ? "✓ Session closed."
      : "⚠️ Session was already closed.";
    void refreshGovernorCommand();
    try {
      await runInSessionContext(0, () => api.editMessageText(
        chatId,
        panelMsgId,
        closeMsg,
        { reply_markup: { inline_keyboard: [] } },
      ));
    } catch { /* ignore */ }
    return;
  }

  if (data.startsWith("session:close_cancel:")) {
    const sid = parseInt(data.slice("session:close_cancel:".length), 10);
    if (isNaN(sid)) return;
    await renderSessionDetail(chatId, panelMsgId, sid);
    return;
  }

  if (data.startsWith("session:primary:")) {
    const sid = parseInt(data.slice("session:primary:".length), 10);
    if (isNaN(sid)) return;
    const sessions = listSessions();
    const target = sessions.find(s => s.sid === sid);
    if (!target) {
      _activePanels.delete(panelMsgId);
      try {
        await runInSessionContext(0, () => api.editMessageText(
          chatId,
          panelMsgId,
          "⚠️ Session no longer active.",
          { reply_markup: { inline_keyboard: [] } },
        ));
      } catch { /* ignore */ }
      return;
    }

    const oldSid = getGovernorSid();
    setGovernorSid(sid);
    const newLabel = `${target.color} ${target.name}`;

    sendServiceMessage(`🔀 ${newLabel} is now the primary session.`).catch(() => {});

    deliverServiceMessage(
      sid,
      `You are now the governor. Ambiguous messages will be routed to you.`,
      "governor_changed",
      { old_governor_sid: oldSid, new_governor_sid: sid },
    );

    if (oldSid > 0 && oldSid !== sid) {
      const oldGovernor = sessions.find(s => s.sid === oldSid);
      if (oldGovernor) {
        deliverServiceMessage(
          oldSid,
          `You are no longer the governor. ${newLabel} is now the governor.`,
          "governor_changed",
          { old_governor_sid: oldSid, new_governor_sid: sid },
        );
      }
    }

    for (const s of sessions) {
      if (s.sid === sid || s.sid === oldSid) continue;
      deliverServiceMessage(
        s.sid,
        `Governor changed: ${newLabel} is now the governor.`,
        "governor_changed",
        { old_governor_sid: oldSid, new_governor_sid: sid },
      );
    }

    _activePanels.delete(panelMsgId);
    try {
      await runInSessionContext(0, () => api.editMessageText(
        chatId,
        panelMsgId,
        `✓ ${newLabel} is now the primary session.`,
        { reply_markup: { inline_keyboard: [] } },
      ));
    } catch { /* ignore */ }
    return;
  }
}

async function renderSessionDetail(
  chatId: number,
  panelMsgId: number,
  sid: number,
): Promise<void> {
  const api = getApi();
  const sessions = listSessions();
  const target = sessions.find(s => s.sid === sid);
  if (!target) {
    // Session gone — go back to list
    if (sessions.length === 0) {
      _activePanels.delete(panelMsgId);
      try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
      return;
    }
    const { text, keyboard } = buildSessionListPanel(sessions);
    try {
      await runInSessionContext(0, () => api.editMessageText(chatId, panelMsgId, text, {
        reply_markup: { inline_keyboard: keyboard },
      }));
    } catch { /* ignore */ }
    return;
  }

  const govSid = getGovernorSid();
  const isGov = target.sid === govSid;
  const lines = [
    `${target.color} *${target.name}*`,
    `SID: ${target.sid}`,
    `Started: ${target.createdAt}`,
    isGov ? "_This is the current primary session._" : "",
  ].filter(Boolean);

  const keyboard: { text: string; callback_data: string }[][] = [
    [
      { text: "🗑 Close session", callback_data: `session:close:${sid}` },
      { text: "⭐ Set as Primary", callback_data: `session:primary:${sid}` },
    ],
    [{ text: "← Back", callback_data: "session:back" }],
  ];

  try {
    await runInSessionContext(0, () => api.editMessageText(
      chatId,
      panelMsgId,
      lines.join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      },
    ));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// /log panel — session recording controls
// ---------------------------------------------------------------------------

async function handleLogCommand(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try {
    const msg = await api.sendMessage(chatId, "📋 *Session Recording*\n\nDump the current session event log to a file.", {
      parse_mode: "Markdown",
      _skipHeader: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📥 Dump session record", callback_data: "log:dump" },
            { text: "✖ Cancel", callback_data: "log:cancel" },
          ],
        ],
      },
    } as Record<string, unknown>);
    _activePanels.set(msg.message_id, "log");
    markInternalMessage(msg.message_id);
  } catch { /* ignore */ }
}

async function handleLogCallback(
  callbackQueryId: string,
  panelMsgId: number,
  data: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  const api = getApi();

  try { await api.answerCallbackQuery(callbackQueryId); } catch { /* ignore */ }
  _activePanels.delete(panelMsgId);

  if (data === "log:dump") {
    doTimelineDump();
    try {
      await runInSessionContext(0, () => api.editMessageText(
        chatId,
        panelMsgId,
        "✓ Session record dumped.",
        { parse_mode: "Markdown", _skipHeader: true, reply_markup: { inline_keyboard: [] } } as Record<string, unknown>,
      ));
    } catch { /* ignore */ }
  } else {
    // cancel
    try { await api.deleteMessage(chatId, panelMsgId); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Timeline dump — writes to local log file (no Telegram file send)
// ---------------------------------------------------------------------------

/**
 * Roll the local log file. Called by manual (/logging → Dump) and at shutdown.
 *
 * The local log is always-on and captures all events continuously via the
 * setOnLocalLog hook in index.ts. This function triggers a roll so the
 * current log file is finalized and a new one starts.
 *
 * Emits a service notification to chat with the archived filename.
 *
 * @param incremental Retained for call-site compatibility; unused.
 */
export function doTimelineDump(_incremental = false): void {
  try {
    const filename = rollLog();
    if (filename) {
      void sendServiceMessage(`📋 Log file created: \`${filename}\``).catch(() => {});
    }
  } catch { /* best-effort */ }
}

/** For testing only: resets module-scoped state. */
export function resetBuiltInCommandsForTest(): void {
  _activePanels.clear();
  _sessionPrefsAsked = false;
  setAutoDumpThreshold(null);
  _dumpCursor = 0;
  cancelAutoApprove();
}
