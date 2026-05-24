---
type: idea
status: parked
filed-by: Curator
date: 2026-05-23
origin: operator voice 2026-05-23 (re Zhu-Li noise after restart)
---

# TMCP: silent startup/shutdown mode for personal-assistant pods

## Operator request

> "There needs to be a way to get it right. The idea is that by default there's a setting that says don't announce the creation and death of Telegram MCP because it's always going to get restarted. And it could get noisy. And so for Julie [Zhu-Li], it is noisy."

## Problem

Every TMCP `session/start` and `session/close` posts a visible announcement in the Telegram chat. For containerized personal-assistant pods with `restart: unless-stopped`, every restart cycle = "Session joined: Zhu-Li" + (later) "Session closed: Zhu-Li" — over time, a noise floor that buries real messages.

## Proposed

Add a profile-level setting `silent_lifecycle: bool` (default false for backward compat). When true:
- `session/start` does NOT emit the public session-joined announcement.
- `session/close` does NOT emit the public session-closed announcement.
- Governor (the always-on operator-facing session) is still notified internally via service-message, so routing isn't broken.
- The operator's view: lifecycle is quiet; the pod's actual posts (replies, reactions, status) still appear normally.

## Where it lives

- New profile key `silent_lifecycle` in `profile/load` / `profile/save` actions.
- Honored at `session/start` and `session/close` time.
- Per pod-class: Curator/Overseer = noisy (operator wants to see them appear). BT/Zhu-Li/assistant-pod = silent default once shipped.

## Acceptance criteria

- [ ] `silent_lifecycle: true` in a saved profile suppresses both join and close announcements when that profile is loaded.
- [ ] Governor still receives the service messages for routing.
- [ ] Default remains false (backward compat) — opt-in per pod.
- [ ] Documented in profile docs.

## Out of scope

- Suppressing non-lifecycle messages (those are pod's own posts; pod decides).
- Suppressing the approval-ticket dialog (separate flow).

## Delegation

Curator-owned. Route to Overseer for vetting; then TMCP worker.
