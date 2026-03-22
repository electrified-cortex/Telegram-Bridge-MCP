# [Unreleased]

### Added

- `session_start(reconnect: true)` re-authorization flow: when a session with the same name already exists, shows a simple ✅ Approve / ⛔ Deny dialog to the operator; on approval returns the same SID and PIN so the agent can resume without a server restart.
- Updated `NAME_CONFLICT` error message to hint at `reconnect: true` syntax for session recovery.
