# [Unreleased]

## Fixed

- Fixed `set_reaction` ignoring `temporary` flag — added explicit `temporary` boolean parameter so reactions auto-revert without requiring `restore_emoji` or `timeout_seconds`
- Fixed confirm/choose buttons staying forever after timeout when user sends a text message (#27)

## Changed

- Improved `/voice` panel empty-state hint to mention built-in fallback and link to Kokoro setup
- Replaced VS Code-specific language with client-agnostic terms across README, LOOP-PROMPT, docs, tool descriptions, and pairing wizard output

## Added

- Added Claude Code Docker config example to README
- Added Claude Code configuration instructions (project-scoped `.mcp.json`) to setup guide and README
- Added Kokoro quick-start guide to README — Docker pull, env vars, `/voice` panel, and voice table
- Added troubleshooting entry for multiple instances competing for the same bot token
