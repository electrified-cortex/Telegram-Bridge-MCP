approve — Approve pending session/start request by name (governor only).

Only available when operator has enabled agent delegation via /approve panel.
Governor session approves pending requests from other agents programmatically.
Optionally assign color; falls back to agent's requested color or LRU auto-assignment.

## Params
token: session token (required; must be governor)
target_name: name of pending session to approve (required; must match session/start name exactly)
color: color emoji to assign (optional; from color palette)
  Palette: 🟦 🟩 🟨 🟧 🟥 🟪

## Example
action(type: "approve", token: 1000001, target_name: "Worker 3")
→ { approved: true, target_name: "Worker 3", color: "🟩" }

With color override:
action(type: "approve", token: 1000001, target_name: "Worker 3", color: "🟨")

## Error cases
BLOCKED → delegation not enabled by operator
GOVERNOR_ONLY → caller is not governor
NOT_PENDING → no pending request with that name (may have timed out or been resolved)
INVALID_COLOR → color not in palette

## Flow
1. Worker calls action(type: "session/start", name: "Worker 3", ...)
2. Governor receives service message about pending approval
3. Governor calls action(type: "approve", target_name: "Worker 3")
4. Worker's session/start completes

Related: session/start, session/list, commands/set