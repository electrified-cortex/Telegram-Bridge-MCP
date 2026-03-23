# [Unreleased]

## Fixed

- `session_start` reconnect no longer drains the session queue; queued messages are preserved across reconnects and the actual `pending` count is returned.
