/**
 * Opt-in session recording — supplementary capture layer.
 *
 * The always-on message store (`message-store.ts`) is the primary event log.
 * This module provides an opt-in buffer for the `/session` built-in command
 * flow: start/stop recording, auto-dump when the buffer fills, and export
 * raw entries for the agent's session-prefs questionnaire.
 *
 * `dump_session_record` reads from the message store timeline, NOT from
 * this buffer. This module is only used by the `/session` command panel
 * and the startup prefs prompt.
 */

import type { Update } from "grammy/types";

export interface UserEntry {
  direction: "user";
  update: Update;
}

export interface BotEntry {
  direction: "bot";
  timestamp: string;
  message_id?: number;
  message_ids?: number[];
  content_type: string;
  text?: string;
  caption?: string;
}

export type SessionEntry = UserEntry | BotEntry;

let _active = false;
let _maxUpdates = 50;
let _buffer: SessionEntry[] = [];

// Auto-dump state — fires callback when buffer reaches threshold, then caller
// resets the buffer so recording continues into the next window.
let _autoDumpThreshold: number | null = null;
let _autoDumpCallback: (() => Promise<void>) | null = null;
let _dumpInFlight = false;

export function startRecording(maxUpdates: number = 50): void {
  _active = true;
  _maxUpdates = maxUpdates;
  _autoDumpThreshold = null;
  _autoDumpCallback = null;
  _dumpInFlight = false;
  _buffer = [];
}

export function stopRecording(): void {
  _active = false;
}

export function isRecording(): boolean {
  return _active;
}

function pushEntry(entry: SessionEntry): void {
  if (_buffer.length >= _maxUpdates) _buffer.shift();
  _buffer.push(entry);
  if (
    _autoDumpThreshold !== null &&
    _autoDumpCallback !== null &&
    _buffer.length >= _autoDumpThreshold &&
    !_dumpInFlight
  ) {
    _dumpInFlight = true;
    const cb = _autoDumpCallback;
    void Promise.resolve().then(async () => {
      try { await cb(); } catch { /* auto-dump is best-effort */ } finally { _dumpInFlight = false; }
    });
  }
}

/** Records an inbound user update (called by message-store). */
export function recordUpdate(update: Update): void {
  if (!_active) return;
  pushEntry({ direction: "user", update });
}

/** Records an outbound bot message (called by message-store). */
export function recordBotMessage(entry: Omit<BotEntry, "direction" | "timestamp">): void {
  if (!_active) return;
  pushEntry({ direction: "bot", timestamp: new Date().toISOString(), ...entry });
}

/** Returns all session entries (user + bot) in capture order (oldest first). */
export function getSessionEntries(): SessionEntry[] {
  return [..._buffer];
}

export function recordedCount(): number {
  return _buffer.length;
}

/** Clears the buffer but keeps recording active with the same max_updates. */
export function clearRecording(): void {
  _buffer = [];
}

export function getMaxUpdates(): number {
  return _maxUpdates;
}

/**
 * Configures automatic dumping: when the buffer hits `threshold` entries the
 * callback fires asynchronously. Callback should dump the log then call
 * `clearRecording()` to reset for the next window. Pass `null` to disable.
 */
export function setAutoDump(threshold: number | null, callback: (() => Promise<void>) | null): void {
  _autoDumpThreshold = threshold;
  _autoDumpCallback = callback;
  _dumpInFlight = false;
}

export function getAutoDumpThreshold(): number | null {
  return _autoDumpThreshold;
}
