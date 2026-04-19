message/route — Route ambiguous message to specific session.

Governor-only. Receives ambiguous messages (not addressed to a specific session) and delegates to appropriate session based on topic relevance.

## Params
token: session token (required; must be governor)
message_id: ID of message to route (required)
target_sid: session ID to route message to (required)

## Example
action(type: "message/route", token: 1000001, message_id: 42, target_sid: 3)
→ { routed: true, target_sid: 3 }

## Error cases
NOT_GOVERNOR → caller is not the governor session
SESSION_NOT_FOUND → target_sid doesn't exist
ROUTE_FAILED → message not found or target queue unavailable

## Routing flow
1. Ambiguous message arrives in governor dequeue
2. Governor identifies relevant session via session/list
3. action(type: "message/route", ..., target_sid: N)
4. Target session receives message on next dequeue

Related: session/list, session/idle, message/get