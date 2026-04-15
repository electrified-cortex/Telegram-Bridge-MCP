log/debug — Read server debug trace log (governor only).

Returns entries from in-memory ring buffer (max 2000). Cursor-based pagination via `since`.
Can also toggle debug mode on/off. Categories: session, route, queue, cascade, dm, animation, tool, health.

## Params
token: session token (required; governor only)
count: max entries to return (optional; default 50; max 500)
category: filter to single category (optional)
  Values: session | route | queue | cascade | dm | animation | tool | health
since: return only entries with id > since (optional; cursor pagination)
enable: toggle debug logging on/off (optional; true/false)

## Examples
Read recent 50 entries:
action(type: "log/debug", token: 1000001)
→ { enabled: true, total: 1234, returned: 50, entries: [...] }

Filter by category:
action(type: "log/debug", token: 1000001, category: "route", count: 100)

Toggle debug on:
action(type: "log/debug", token: 1000001, enable: true)

Paginate with cursor:
action(type: "log/debug", token: 1000001, since: 500)

Related: logging/toggle, log/get, log/list