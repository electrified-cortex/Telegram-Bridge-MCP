# [Unreleased]

## Added

- `send_new_progress` auto-pins the new message (silent) after creation
- `send_new_checklist` auto-pins the new message (silent) after creation
- `update_progress` auto-unpins the message when `percent` reaches 100
- `update_checklist` auto-unpins the message when all steps reach a terminal status (`done`/`failed`/`skipped`)
