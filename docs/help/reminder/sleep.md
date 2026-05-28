reminder/sleep — Temporarily suppress a reminder until a given datetime.

Sleep state is TRANSIENT — not persisted across session end or profile/save. The reminder resumes automatically when now >= until. To wake early: call again with a past datetime. For indefinite suppression: use a far-future date (e.g. "9999-12-31T00:00:00Z"). Does not affect the disabled flag — a disabled reminder stays disabled after sleep expires.

## Params
token: session token (required)
id: reminder ID to sleep (required; from reminder/list)
until: ISO-8601 datetime after which the reminder resumes firing (required)

## Example
action(type: "reminder/sleep", token: 3165424, id: "abc123", until: "2026-06-01T09:00:00Z")
→ { sleeping: true, id: "abc123", until: "2026-06-01T09:00:00Z" }

If until is already in the past:
→ { sleeping: false, id: "abc123", until: "...", note: "until is in the past — reminder will fire normally on next tick." }

## Error cases
NOT_FOUND → no reminder with that ID; check reminder/list for valid IDs
INVALID_PARAM → until is not a valid ISO-8601 datetime string

Related: reminder/disable, reminder/enable, reminder/list
