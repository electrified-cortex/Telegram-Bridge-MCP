---
id: "10-0880"
title: "Strengthen activity-file onboarding for Monitor-capable runtimes"
type: feature
priority: 10
status: queued
created: 2026-05-05
filed-by: Overseer (formalized by Curator)
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

# Strengthen activity/file onboarding for Monitor-capable runtimes

## Problem
The onboarding_loop_pattern service message mentions activity files as an "augment" but language is too weak. Agents in Monitor-capable runtimes (Claude Code) don't automatically wire it up.

## Goal
Update onboarding language to be runtime-conditional:
- If runtime has Monitor/file-watcher → create activity file + start watcher background process → Monitor fires → dequeue(max_wait: 0)
- If runtime lacks Monitor (VS Code etc.) → skip gracefully, use standard long-poll

## Acceptance criteria
- [ ] onboarding_loop_pattern message updated with runtime-conditional guidance
- [ ] Concrete bash/PS example of mtime watcher provided
- [ ] Non-Monitor runtimes don't break or get confused
- [ ] Tested in Claude Code: activity file wired, Monitor fires on inbound message, dequeue called

## Notes
Filed 2026-05-05 based on operator feedback session.
