/**
 * Per-session singleton for the active voice override.
 *
 * **Purpose:** When multiple sessions are active, `set_voice` lets each session
 * use a different TTS voice — so you can tell which agent is speaking.
 *
 * **Scope:** Per-session, keyed by SID via `getCallerSid()`. In single-session
 * mode (SID 0) the map has a single entry — behaviour is identical to the old
 * global singleton.
 */

import { getCallerSid } from "./session-context.js";

const _voices = new Map<number, string | null>();
const _speeds = new Map<number, number | null>();

export function getSessionVoice(): string | null {
  return _voices.get(getCallerSid()) ?? null;
}

/**
 * Set the active voice override for the current session. Pass an empty string to clear.
 */
export function setSessionVoice(voice: string): void {
  _voices.set(getCallerSid(), voice.trim() || null);
}

export function clearSessionVoice(): void {
  _voices.delete(getCallerSid());
}

/**
 * Direct SID lookup — used by outbound proxy and tests to read another session's voice.
 */
export function getSessionVoiceFor(sid: number): string | null {
  return _voices.get(sid) ?? null;
}

export function getSessionSpeed(): number | null {
  return _speeds.get(getCallerSid()) ?? null;
}

export function setSessionSpeed(speed: number): void {
  _speeds.set(getCallerSid(), speed);
}

export function clearSessionSpeed(): void {
  _speeds.delete(getCallerSid());
}

/**
 * Direct SID lookup — used by save_profile to read another session's speed.
 */
export function getSessionSpeedFor(sid: number): number | null {
  return _speeds.get(sid) ?? null;
}

/** For testing only: resets all voice state so env is clean between tests. */
export function resetVoiceStateForTest(): void {
  _voices.clear();
  _speeds.clear();
}
