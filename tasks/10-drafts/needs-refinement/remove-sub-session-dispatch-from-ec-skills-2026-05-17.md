---
title: Remove sub-session-dispatch skill from EC skills repo
stage: 10-drafts
author: Foreman (sub-session-dispatch-skill-migration task)
date: 2026-05-17
target_repo: electrified-cortex/skills
priority: P3
related:
  - tasks/70-done/2026/05/17/sub-session-dispatch-skill-migration-2026-05-17.md (source task)
---

# Remove sub-session-dispatch from EC skills repo

## Problem
`sub-session-dispatch` has been migrated to TMCP (commit on dev). The copy in
`electrified-cortex/skills/sub-session-dispatch/` is now redundant.

## Scope
Remove `electrified-cortex/skills/sub-session-dispatch/SKILL.md` (and the directory)
on the next publish cycle for the EC plugin. Do NOT remove until the EC plugin has
been republished without it.

## Out of scope
- TMCP v8 plugin scaffolding (separate task)
- EC plugin republish itself (separate task)

## Acceptance criteria
1. `electrified-cortex/skills/sub-session-dispatch/` directory removed.
2. Change committed and published in EC plugin.
