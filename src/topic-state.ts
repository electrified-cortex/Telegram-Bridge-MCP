/**
 * Module-level singleton for the active default title.
 *
 * **Purpose:** When multiple MCP host instances each run their own MCP server
 * process (one Telegram-facing chat per instance), `set_topic` lets each process
 * prepend a default title to its outbound messages — e.g. `[Refactor Agent]`
 * or `[Test Runner]` — so you can tell which agent sent what in the same chat.
 *
 * **Scope:** Module-level (process-scoped). Works correctly when there is one
 * MCP server process per host instance. Multiple chat sessions sharing the
 * same host instance share one process and therefore one title — the last
 * call wins.
 */

let _topic: string | null = null;

export function getTopic(): string | null {
  return _topic;
}

/**
 * Set the active default title. Pass an empty string to clear.
 */
export function setTopic(topic: string): void {
  _topic = topic.trim() || null;
}

export function clearTopic(): void {
  _topic = null;
}

/**
 * Prepend `[Topic] ` to a title string (used in notify, send_new_checklist).
 * The caller's tool is responsible for bold-formatting the title — this
 * just injects the label inline so it appears inside the bold heading.
 */
export function applyTopicToTitle(title: string): string {
  return _topic ? `[${_topic}] ${title}` : title;
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
  if (!_topic) return text;
  if (mode === "HTML") return `<b>[${_topic}]</b>\n${text}`;
  if (mode === "MarkdownV2") return text; // raw V2 — don't inject
  // Markdown — will be converted to MarkdownV2 by markdownToV2()
  return `**[${_topic}]**\n${text}`;
}

/** For testing only: resets topic state so env is clean between tests. */
export function resetTopicStateForTest(): void {
  _topic = null;
}
