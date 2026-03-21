# [Unreleased]

## Added

- `send_text`: When the message body contains a markdown table (pipe-delimited rows), the tool response now includes an advisory `info` field warning that Telegram does not render markdown tables.

## Fixed

- `show_animation`: When `editMessageText` fails during `updateDisplay`, the old animation message is now deleted (best-effort) to prevent orphaned static frames remaining in chat.

## Changed

- `session_start`: First session announcement is no longer pinned immediately; pinning is deferred until a second session joins.
- `session_start`: When a second session joins, the first session's announcement is retroactively pinned before the new session's announcement is pinned.
- `close_session`: When closing the penultimate session (2→1), the remaining session's announcement is now unpinned (single-session mode needs no pins).
