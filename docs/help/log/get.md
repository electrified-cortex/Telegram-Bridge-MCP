log/get — Read local log file by filename (governor only).

Returns log content via MCP tool response. Log content never transits Telegram.
Omit filename to list available log files (same as log/list).

## Params
token: session token (required; governor only)
filename: log filename to read (optional; e.g. "2025-04-05T143022.json")
  Omit to list available log files

## Examples
Read specific log:
action(type: "log/get", token: 1000001, filename: "2025-04-05T143022.json")
→ { content: [{ type: "text", text: "..." }] }

List logs (omit filename):
action(type: "log/get", token: 1000001)
→ { current_log: "...", log_files: [...], count: 3 }

## Typical pattern
1. action(type: "log/list", token: ...) → see available files
2. action(type: "log/get", token: ..., filename: "...") → read content
3. action(type: "log/delete", token: ..., filename: "...") → clean up

Related: log/list, log/roll, log/delete, logging/toggle