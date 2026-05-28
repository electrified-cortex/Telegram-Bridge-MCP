name-tag — Get or set the session name tag used in message headers.

The name tag appears as the header on outbound messages. By default it is auto-derived from the session's color + name (e.g. "🟦 Curator"). Override it for a custom label; reset by passing an empty string.

Both action types use the same handler:
- action(type: "name-tag") — get the current effective tag
- action(type: "name-tag/set", name_tag: "...") — set an override

## Params
token: session token (required)
name_tag: custom tag string (required for name-tag/set; omit for name-tag GET)
  Max 64 chars. No newlines. No backticks.
  Pass empty string "" to reset to the auto-default.

## Example — read
action(type: "name-tag", token: 3165424)
→ { name_tag: "🟦 Curator", custom: false }

## Example — set
action(type: "name-tag/set", token: 3165424, name_tag: "Curator Prime")
→ { name_tag: "Curator Prime", custom: true }

## Example — reset to auto-default
action(type: "name-tag/set", token: 3165424, name_tag: "")
→ { name_tag: "🟦 Curator", custom: false }

## Error cases
INVALID_NAME_TAG → value contains a newline or backtick, or exceeds 64 chars
SESSION_NOT_FOUND → token does not resolve to a valid session

Related: session/rename, session/status
