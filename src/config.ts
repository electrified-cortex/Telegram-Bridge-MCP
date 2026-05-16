/**
 * Persistent MCP configuration — stored as JSON next to .env.
 *
 * Session log mode:
 *   - undefined / missing key → disabled (no dumps)
 *   - "manual"                → always recording, manual dumps only
 *   - number (e.g. 50)       → always recording + auto-dump every N events
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "mcp-config.json");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

interface McpConfig {
  sessionLog?: "manual" | number;
  defaultVoice?: string;
  voices?: VoiceEntry[];
  debug?: boolean;
  sessionApproval?: "governor" | "manual" | "auto";
  preToolHook?: {
    denyPatterns?: string[];
  };
}

export interface VoiceEntry {
  name: string;
  description?: string;
  language?: string;
  gender?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (loaded once, written on change)
// ---------------------------------------------------------------------------

let _config: McpConfig = {};

function load(): McpConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed;
  } catch {
    return {};
  }
}

function save(): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort — ignore disk errors (read-only containers, permission denied, etc.)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load config from disk. Call once at startup. */
export function loadConfig(): void {
  _config = load();
}

/**
 * Session log mode:
 *   - `null`     → disabled
 *   - `"manual"` → recording, manual dumps
 *   - `number`   → recording + auto-dump every N events
 */
export function getSessionLogMode(): "manual" | number | null {
  const val = _config.sessionLog;
  if (val === "manual") return "manual";
  if (typeof val === "number" && val > 0) return val;
  return null;
}

/** Set session log mode and persist to disk. */
export function setSessionLogMode(mode: "manual" | number | null): void {
  if (mode === null) {
    delete _config.sessionLog;
  } else if (mode === "manual") {
    _config.sessionLog = mode;
  } else {
    const clamped = Math.floor(mode);
    if (Number.isFinite(clamped) && clamped >= 1) {
      _config.sessionLog = clamped;
    } else {
      delete _config.sessionLog;
    }
  }
  save();
}

/** Human-readable label for the current mode. */
export function sessionLogLabel(): string {
  const mode = getSessionLogMode();
  if (mode === null) return "disabled";
  if (mode === "manual") return "manual";
  return `every ${mode} messages`;
}

// ---------------------------------------------------------------------------
// Session approval mode
// ---------------------------------------------------------------------------

/** Get the configured session approval mode (default: "manual"). */
export function getSessionApproval(): "governor" | "manual" | "auto" {
  return _config.sessionApproval ?? "manual";
}

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

/** Whether debug logging is enabled (config file or env var fallback). */
export function isDebugConfig(): boolean {
  return _config.debug === true || !!process.env["TELEGRAM_MCP_DEBUG"];
}

// ---------------------------------------------------------------------------
// Voice configuration
// ---------------------------------------------------------------------------

/** Get the configured default voice (if any). */
export function getDefaultVoice(): string | null {
  return _config.defaultVoice ?? null;
}

/** Set the default voice and persist to disk. Pass null to clear. */
export function setDefaultVoice(voice: string | null): void {
  if (voice) {
    _config.defaultVoice = voice;
  } else {
    delete _config.defaultVoice;
  }
  save();
}

/** Get the configured voice menu (if any). */
export function getConfiguredVoices(): VoiceEntry[] {
  return _config.voices ?? [];
}

/** Set the voice menu and persist to disk. */
export function setConfiguredVoices(voices: VoiceEntry[]): void {
  if (voices.length > 0) {
    _config.voices = voices;
  } else {
    delete _config.voices;
  }
  save();
}

// ---------------------------------------------------------------------------
// Pre-tool hook deny patterns
// ---------------------------------------------------------------------------

/** Get the list of deny patterns for the pre-tool hook (empty if not set). */
export function getPreToolDenyPatterns(): string[] {
  return _config.preToolHook?.denyPatterns ?? [];
}

/** Set deny patterns and persist to disk.  Pass [] to clear. */
export function setPreToolDenyPatterns(patterns: string[]): void {
  if (patterns.length > 0) {
    _config.preToolHook = { ..._config.preToolHook, denyPatterns: patterns };
  } else {
    if (_config.preToolHook) {
      delete _config.preToolHook.denyPatterns;
      if (Object.keys(_config.preToolHook).length === 0) {
        delete _config.preToolHook;
      }
    }
  }
  save();
}

/** For testing only. */
export function resetConfigForTest(): void {
  _config = {};
}
