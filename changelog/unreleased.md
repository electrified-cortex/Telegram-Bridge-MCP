# [Unreleased]

## Changed

- Changed `dequeue_update` default timeout from 60 s to 300 s (maximum), optimized for agent listen loops
- Renamed `empty: true` response field to `timed_out: true` in `dequeue_update` to signal "call again" rather than "nothing here"
- Updated `docs/behavior.md` to reflect new default timeout, `timed_out` response semantics, and the rule to check in with the user after each full 300 s timeout
