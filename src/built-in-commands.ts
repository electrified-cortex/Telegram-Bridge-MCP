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
import { getApi, resolveChat } from "./telegram.js";
import { elegantShutdown, setShutdownDumpHook } from "./shutdown.js";

import { getSessionLogMode, setSessionLogMode, sessionLogLabel } from "./config.js";
import { getDefaultVoice, setDefaultVoice, getConfiguredVoices } from "./config.js";
import type { VoiceEntry } from "./config.js";
import { fetchVoiceList, isTtsEnabled } from "./tts.js";


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
import { dumpTimeline, dumpTimelineSince, timelineSize, storeSize, setOnEvent } from "./message-store.js";

// ---------------------------------------------------------------------------
// Tracking panel message IDs so callback_query intercept can route back
// ---------------------------------------------------------------------------

/** Maps from message_id → panel type so we can route callback_queries back to us. */
const _activePanels = new Map<number, "session" | "voice" | "voice-sample">();

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

// Wire up the session-log dump hook for elegant shutdown (avoids circular import)
setShutdownDumpHook(async () => {
  if (getSessionLogMode() !== null) {
    await doTimelineDump(true);
  }
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
  { command: "session", description: "Session recording controls" },
  { command: "voice", description: "Change the TTS voice" },
  { command: "version", description: "Show server version and build info" },
  { command: "shutdown", description: "Shut down the MCP server" },
] as const;

const _builtInCommandNames = new Set<string>(BUILT_IN_COMMANDS.map(c => c.command));

/**
 * Message IDs for bot-sent session infrastructure messages (panel, dump docs,
 * notices) that should be excluded from the session record dump.
 * The events still appear in the timeline and flow through dequeue_update —
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
 * is still stored in the timeline and visible to dequeue_update — it just
 * shouldn't pollute the record.
 */
export function isInternalTimelineEvent(evt: Omit<TimelineEvent, "_update">): boolean {
  if (_internalMessageIds.has(evt.id)) return true;
  if (evt.event === "message" && evt.content.type === "command") {
    return _builtInCommandNames.has(evt.content.text ?? "");
  }
  if (evt.event === "callback" && typeof evt.content.data === "string") {
    return evt.content.data.startsWith("session:") || evt.content.data.startsWith("voice:");
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
      if (raw === "session") {
        await handleSessionCommand();
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
      } else {
        await handleSessionCallback(update.callback_query.id, msgId, update.callback_query.data ?? "");
      }
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
    await api.editMessageText(chatId, panelMsgId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
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
    const ogg = await synthOgg(sampleText, voiceName);
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
    markInternalMessage(msg.message_id);
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
    timeline = result.events.filter(evt => !isInternalTimelineEvent(evt));
    _dumpCursor = result.nextCursor;
  } else {
    timeline = dumpTimeline().filter(evt => !isInternalTimelineEvent(evt));
    _dumpCursor = timelineSize();
  }

  if (timeline.length === 0) {
    if (!incremental) {
      try {
        const noEvtMsg = await api.sendMessage(chatId, "🗒 *Session Record*\n_(no events captured)_", {
          parse_mode: "Markdown",
        });
        markInternalMessage(noEvtMsg.message_id);
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
    const label = `🗒 Session record · ${timeline.length} events${incremental ? " (incremental)" : ""}`;
    const msg = await api.sendDocument(chatId, file, { caption: label }) as {
      message_id: number;
      document?: { file_id?: string };
    };
    markInternalMessage(msg.message_id);

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
      const fallbackMsg = await api.sendMessage(chatId, `\`\`\`json\n${json.slice(0, 3900)}\n\`\`\``, {
        parse_mode: "Markdown",
      });
      markInternalMessage(fallbackMsg.message_id);
    } catch { /* ignore */ }
  }
}

function buildSessionPanel(): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  const recordSize = dumpTimeline().filter(evt => !isInternalTimelineEvent(evt)).length;
  const mSize = storeSize();
  const mode = getSessionLogMode();

  const lines = [
    `🗒 *Session Record*`,
    `Mode: ${sessionLogLabel()}`,
    `Timeline: ${recordSize} events · ${mSize} messages`,
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
    modeButtons.push({ text: "🫵 Manual", callback_data: "session:manual" });
  }
  if (typeof mode !== "number") {
    modeButtons.push({ text: "⏩ Auto-dump", callback_data: "session:autodump" });
  } else {
    modeButtons.push({ text: `⏩ Auto (${mode})`, callback_data: "session:autodump" });
  }

  // Row 2: actions
  const actionButtons: { text: string; callback_data: string }[] = [];
  if (mode !== null && recordSize > 0) {
    actionButtons.push({ text: "⬇️ Dump record", callback_data: "session:dump" });
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
