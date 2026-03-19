/**
 * Per-session singleton for the active default title.
 *
 * **Purpose:** When multiple sessions are active, `set_topic` lets each session
 * prepend a default title to its outbound messages — e.g. `[Refactor Agent]`
 * or `[Test Runner]` — so you can tell which agent sent what in the same chat.
 *
 * **Scope:** Per-session, keyed by SID via `getCallerSid()`. In single-session
 * mode (SID 0) the map has a single entry — behaviour is identical to the old
 * global singleton.
 */

import { getCallerSid } from "./session-context.js";

const _topics = new Map<number, string | null>();

function _current(): string | null {
  return _topics.get(getCallerSid()) ?? null;
}

export function getTopic(): string | null {
  return _current();
}

/**
 * Set the active default title. Pass an empty string to clear.
 */
export function setTopic(topic: string): void {
  _topics.set(getCallerSid(), topic.trim() || null);
}

export function clearTopic(): void {
  _topics.delete(getCallerSid());
}

/**
 * Prepend `[Topic] ` to a title string (used in notify, send_new_checklist).
 * The caller's tool is responsible for bold-formatting the title — this
 * just injects the label inline so it appears inside the bold heading.
 */
export function applyTopicToTitle(title: string): string {
  const topic = _current();
  return topic ? `[${topic}] ${title}` : title;
}

/**
 * Prepend a bold topic header line to a message body.
 *
 * Format is parse_mode-aware:
 * - Markdown (default): `**[Topic]**\n` — converted to V2 by markdownToV2()
 * - HTML: `<b>[Topic]</b>\n`
 * - MarkdownV2: not injected — caller is managing all escaping manually
 */
export function applyTopicToText(
  text: string,
  mode: "Markdown" | "MarkdownV2" | "HTML" = "Markdown",
): string {
  const topic = _current();
  if (!topic) return text;
  if (mode === "HTML") return `<b>[${topic}]</b>\n${text}`;
  if (mode === "MarkdownV2") return text; // raw V2 — don't inject
  // Markdown — will be converted to MarkdownV2 by markdownToV2()
  return `**[${topic}]**\n${text}`;
}

/** For testing only: resets all topic state so env is clean between tests. */
export function resetTopicStateForTest(): void {
  _topics.clear();
}
