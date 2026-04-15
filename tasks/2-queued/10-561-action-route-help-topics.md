---
Created: 2026-04-15
Status: Queued
Host: local
Priority: 10-561
Source: Operator directive (documentation breadcrumbs)
---

# 10-561: Help topics for every action route

## Objective

Every action route needs a `docs/help/<route>.md` file with documentation,
usage examples, and breadcrumbs to related routes. Agents should be able
to call `help(topic: "shutdown/warn")` and get actionable docs.

## Context

The 10-560 audit identified 44 action routes. Many have no help topic.
Agents currently rely on the guide or guessing. Each route should be
self-documenting via the help system.

## Scope

For each action route category:
- `session/*` — start, reconnect, list, close, rename, idle
- `shutdown/*` — warn
- `profile/*` — load, save, voice, topic, dequeue-default, import
- `message/*` — edit, delete, pin, get, history, route
- `log/*` — debug, get, list, roll, delete, trace (post 10-498)
- `reminder/*` — set, cancel, list
- `animation/*` — default, cancel
- `commands/*` — set
- `react`, `acknowledge`, `show-typing`, `approve`, `download`, `transcribe`
- `confirm/*`, `checklist/*`, `progress/*`

## Acceptance Criteria

- [ ] Every registered action route has a `docs/help/` topic file
- [ ] Each topic includes: description, parameters, example, related routes
- [ ] `help(topic: "<route>")` returns the content
- [ ] Breadcrumb links between related routes (e.g. shutdown/warn → session/close)
- [ ] Category index topics (e.g. `help(topic: "session")` lists all session routes)
