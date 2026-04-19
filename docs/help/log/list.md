log/list — List all archived local log files (governor only).

Returns filenames sorted oldest-first, plus current active log status.
Log content never transits Telegram — use log/get to read a specific file.

## Params
token: session token (required; governor only)

## Example
action(type: "log/list", token: 1000001)
→ {
  logging_enabled: true,
  current_log: "2025-04-05T143022.json",
  archived_logs: ["2025-04-04T090011.json", "2025-04-05T000000.json"],
  archived_count: 2
}

Related: log/get, log/roll, log/delete, logging/toggle