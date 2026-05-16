/**
 * Canonical Claude Code Monitor recipe for the TMCP activity-file mtime kick.
 *
 * Single source of truth — imported by session/start, session/reconnect,
 * and referenced by docs/help/activity/file.md.
 *
 * Runs tools/monitor.sh when available (preferred — delegates to native
 * file-watching). Falls back to a 1-second stat-poll loop with a stderr
 * warning if the script is not found. Substitute <ACTIVITY_FILE> with the
 * path returned by `activity/file/get`.
 */
export const CANONICAL_MONITOR_RECIPE =
  `if [ -f tools/monitor.sh ]; then bash tools/monitor.sh "<ACTIVITY_FILE>"; else echo "WARNING: tools/monitor.sh not found; using fallback poll" >&2; f="<ACTIVITY_FILE>"; prev=$(stat -c%Y "$f" 2>/dev/null); while true; do cur=$(stat -c%Y "$f" 2>/dev/null); if [ "$cur" != "$prev" ]; then echo "kick"; prev=$cur; fi; sleep 1; done; fi`;
