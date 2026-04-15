log/delete — Delete archived log file by filename (governor only).

Use after capturing log content via log/get. Acknowledgment ceremony after log retrieval.

## Params
token: session token (required; governor only)
filename: log filename to delete (required; e.g. "2025-04-05T143022.json")

## Example
action(type: "log/delete", token: 1000001, filename: "2025-04-05T143022.json")
→ { deleted: true, filename: "2025-04-05T143022.json" }

## Pattern
Read log content first, then delete:
1. action(type: "log/get", token: ..., filename: "...") → read
2. action(type: "log/delete", token: ..., filename: "...") → delete

Related: log/get, log/list, log/roll