/**
 * Canonical Monitor recipe — activity-file watcher for stdio-mode sessions.
 *
 * Embed this verbatim in service messages or help text.  Replace `<path>`
 * with the value returned by action(type: "activity/file/create").
 *
 * Pass the filled-in command to Monitor(command: ..., persistent: true).
 * On each `kick` line call dequeue() (no max_wait); loop until timed_out: true.
 */
export const ACTIVITY_FILE_MONITOR_RECIPE =
  'bash tools/monitor.sh "<path>"   # Linux / macOS / Git-Bash\n' +
  'pwsh tools/monitor.ps1 "<path>"  # Windows / cross-platform pwsh';
