/**
 * Canonical Claude Code Monitor recipe for the TMCP activity-file mtime kick.
 *
 * Single source of truth — imported by session/start, session/reconnect,
 * and referenced by docs/help/activity/file.md.
 *
 * The recipe polls mtime at 1-second cadence and emits `kick @ <unix-seconds>`
 * on each change. Substitute <ACTIVITY_FILE> with the path returned by
 * `activity/file/get`.
 */
export const CANONICAL_MONITOR_RECIPE =
  `f="<ACTIVITY_FILE>"; prev=$(stat -c%Y "$f" 2>/dev/null); while true; do cur=$(stat -c%Y "$f" 2>/dev/null); if [ "$cur" != "$prev" ]; then echo "kick @ $cur"; prev=$cur; fi; sleep 1; done`;
