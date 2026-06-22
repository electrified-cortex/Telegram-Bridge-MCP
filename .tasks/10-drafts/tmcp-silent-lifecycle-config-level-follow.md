---
title: "silent_lifecycle — revisit as deployment-level config after dogfooding"
priority: low
type: design-follow
delegation: curator
created: 2026-06-22
source: operator-review (TG 77913, 77916, 77917)
after: v7.11.1 dogfood period
---

# silent_lifecycle — Post-Dogfood Design Review

## Background

`silent_lifecycle` was shipped in v7.11.1 as a per-profile flag. It suppresses the `🟢 Online` announcement when a session starts.

## Known limitation

The flag only works if a profile already exists for the agent name at session start time. First-ever startup has no profile → flag cannot suppress the announcement.

## Operator direction

Operator noted: the suppress-announcement intent is a **deployment-level concern** — it should affect all participants globally, not be configured per-agent profile. A config setting (e.g., `MCP_SILENT_LIFECYCLE=true` env var) would:
- Work from session 1 (no pre-existing profile required)
- Apply uniformly to all agents on that deployment

## Action (post-dogfood)

After v7.11.1 ships and gets real use, revisit:
1. Does per-profile `silent_lifecycle` provide any real value in practice?
2. Add `MCP_SILENT_LIFECYCLE=true` env var that overrides all profiles
3. Deprecate or keep per-profile flag depending on feedback

## Acceptance Criteria

1. Env var `MCP_SILENT_LIFECYCLE=true` suppresses announcements for all sessions on that deployment
2. Per-profile flag still works (layered: env var = global default, profile = per-agent override)
3. Documented in help or README
