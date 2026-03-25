# [Unreleased]

## Added

- **`send_new_checklist` auto-pins** the message silently on creation; **`update_checklist` auto-unpins** when all steps reach a terminal status (`done`/`failed`/`skipped`)
- **`send_new_progress` auto-pins** the message silently on creation; **`update_progress` auto-unpins** when `percent` reaches `100`
