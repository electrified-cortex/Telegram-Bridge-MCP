---
id: "10-534"
title: "Rename dequeue timeout parameter to max_wait"
status: draft
priority: 10
created: 2026-04-14
tags: [tmcp, dequeue, ux, agent-confusion]
source: Operator (voice)
---

# Rename Dequeue timeout → max_wait

## Objective

Rename the `timeout` parameter on `dequeue` to `max_wait` to reduce agent confusion. Agents consistently misuse `timeout` as a polling interval — shortening it to "check back sooner" — instead of understanding that dequeue is a blocking long-poll where the session default handles wait time.

## Context

Nearly every agent exhibits this pattern: setting short timeouts (15s, 30s, 60s) when waiting for background work or trying to stay "responsive." The parameter name "timeout" implies something that needs to be managed. `max_wait` better communicates "this is the longest you'll wait before the call returns empty — you almost never need to set it."

## Changes

1. Rename `timeout` parameter to `max_wait` in dequeue tool schema
2. Update `help(topic: 'dequeue')` — add clear guidance: "Omit max_wait. The session default handles blocking. Only use max_wait: 0 for drain loops."
3. Update tool description to emphasize: "Do not shorten max_wait to poll for other events. Background agents notify you independently."
4. Consider whether `timeout: 0` drain case should become a separate `drain: true` flag for clarity

## Acceptance Criteria

- [ ] Parameter renamed from `timeout` to `max_wait`
- [ ] Help topic updated with anti-pattern guidance
- [ ] Tool description updated
- [ ] Existing agent docs/skills referencing `dequeue(timeout: ...)` updated
- [ ] Backward compat: `timeout` still accepted as alias (deprecation warning optional)
