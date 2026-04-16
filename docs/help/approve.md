approve — Approve pending session/start request by ticket (governor only).

Only available when operator has enabled agent delegation via /approve panel.
Governor session approves pending requests from other agents programmatically.
Optionally assign color; falls back to agent's requested color or LRU auto-assignment.

## Params
token: session token (required; must be governor)
ticket: one-time approval ticket delivered to the governor via dequeue when the session requested approval (required)
color: color emoji to assign (optional; from color palette)
  Palette: 🟦 🟩 🟨 🟧 🟥 🟪

## Example
action(type: "approve", token: 1000001, ticket: "abc123")
→ { approved: true, name: "Worker 3", color: "🟩" }

With color override:
action(type: "approve", token: 1000001, ticket: "abc123", color: "🟨")

## Error cases
BLOCKED → delegation not enabled by operator
GOVERNOR_ONLY → caller is not governor
NOT_PENDING → no pending request with that name (may have timed out or been resolved)
INVALID_COLOR → color not in palette

## Flow
1. Worker calls action(type: "session/start", name: "Worker 3", ...)
2. Governor receives service message about pending approval
3. Governor calls action(type: "approve", token: ..., ticket: "abc123")
4. Worker's session/start completes

Related: session/start, session/list, commands/set