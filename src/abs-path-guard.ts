/**
 * Detects absolute filesystem paths in outbound message text.
 *
 * Patterns (per AC1):
 * - Windows drive-letter prefix: `<letter>:[/\]` — e.g. `C:/`, `D:\`, `D:\\Users`
 * - Unix root-anchored common dev paths: `/Users/`, `/home/`, `/d/`, `/c/`, `/mnt/`, `/usr/local/`
 */

/**
 * Regex that matches the beginning of an absolute path.
 * Matches one of:
 *   - Windows: letter + colon + forward-slash or backslash  (e.g. "C:/" "D:\" "D:\\")
 *   - Unix dev mounts: the exact prefix including the trailing slash
 *     (/Users/, /home/, /d/, /c/, /mnt/, /usr/local/)
 */
const ABS_PATH_RE =
  /[A-Za-z]:[/\\]|\/Users\/|\/home\/|\/d\/|\/c\/|\/mnt\/|\/usr\/local\//;

/**
 * Scan `text` for an absolute filesystem path.
 *
 * Returns a short snippet starting at the first match (up to 60 chars,
 * stopping at the first whitespace or newline) so the caller can include it
 * in an error message. Returns `null` when no match is found.
 */
export function findAbsolutePath(text: string): string | null {
  const match = ABS_PATH_RE.exec(text);
  if (!match) return null;

  // Extract a human-readable snippet starting at the match position.
  const tail = text.slice(match.index);
  const stopAt = tail.search(/[\s\n\r"'`]/);
  const snippet = stopAt === -1 ? tail.slice(0, 60) : tail.slice(0, Math.min(stopAt, 60));
  return snippet.length > 0 ? snippet : match[0];
}

/**
 * Build the standardised error payload returned to the agent when an absolute
 * path is detected and no safety override is in effect.
 */
export function absPathBlockedError(snippet: string): {
  code: "ABS_PATH_BLOCKED";
  message: string;
  hint: string;
} {
  return {
    code: "ABS_PATH_BLOCKED",
    message:
      `Absolute path detected in outbound message: "${snippet}". ` +
      `Sending raw filesystem paths leaks host machine details. ` +
      `Use a relative placeholder instead — e.g. <workspace>/... or <repo>/...`,
    hint:
      `Replace the absolute path with a relative placeholder (<workspace>/... or <repo>/...). ` +
      `If you genuinely need to send this path, retry with \`safety: "disable"\` on the call.`,
  };
}
