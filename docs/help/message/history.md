message/history — Get recent conversation history from timeline.

Returns events oldest-first (chronological). Use before_id to page backwards.
has_more: true when older events exist beyond returned window.

## Params
token: session token (required)
count: number of events to return (optional; default 20; max 50)
before_id: return events older than this event ID (optional; for pagination)

## Examples
Recent 20 events:
action(type: "message/history", token: 3165424)
→ { events: [...], has_more: false }

Last 50 events:
action(type: "message/history", token: 3165424, count: 50)

Page backwards:
action(type: "message/history", token: 3165424, before_id: 1234, count: 20)
→ { events: [...], has_more: true }

## Notes
- Timeline is in-memory; does not fetch from Telegram API
- Evicted events not recoverable

Related: message/get, message/route