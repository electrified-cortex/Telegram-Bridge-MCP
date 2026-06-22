---
title: BUG/REQ — subsessions MUST enforce a topic (never optional)
filed: 2026-06-10
source: operator testing (relayed via subsession sid 3 → Curator)
relates: tasks/10-drafts/10-2100-threaded-conversations-prd.md
status: draft / needs investigation + enforcement
severity: requirement (operator: "absolutely must have a topic")
---

## Requirement (operator, via subsession test 2026-06-10)

Subsessions (spawn-child) **MUST have a topic** — topics cannot be optional. Operator notes this failed once before (a subsession with no topic). Wants investigation + confirmed enforcement.

## Initial investigation (Curator)
- `src/tools/session/spawn-child.ts:90` — `setTopic(\`${name} ${circleDigit}\`)` is always called, so a topic IS set in the normal path.
- **Gap:** the topic is derived from the `name` param. If `name` is empty/missing, the topic degenerates to just the circle digit (e.g. " ①") — effectively "no topic." That is the likely failure mode the operator hit.
- `name` param is described at `spawn-child.ts:123` ("Topic name for the child session…") but enforcement that it is **non-empty** is unconfirmed.

## Ask
1. Confirm whether `name` (→ topic) can be empty/missing at `spawn-child` entry; if so, REJECT it (require a non-empty topic) — make topic mandatory at the schema + handler level.
2. Add a regression test: spawn-child with empty/missing name → error (no degenerate/empty topic).
3. Confirm enforcement end-to-end (topic always rendered as `[Name ①]`).
