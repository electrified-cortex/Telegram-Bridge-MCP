/**
 * Routing state for multi-session ambiguous message dispatch.
 *
 * Three routing models: broadcast (all sessions), governor (one designated
 * session handles ambiguous messages and delegates via route_message), and
 * pass-through (single active session, no routing logic). Targeted messages
 * (reply-to / callbacks / reactions traceable to a specific session) are
 * always delivered directly to that session without consulting the governor.
 *
 * Governor state is set automatically when a second session joins.
 * Stored in-memory only; resets on MCP restart.
 */

let _governorSid = 0;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getGovernorSid(): number {
  return _governorSid;
}

export function setGovernorSid(sid: number): void {
  _governorSid = sid;
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetRoutingModeForTest(): void {
  _governorSid = 0;
}
