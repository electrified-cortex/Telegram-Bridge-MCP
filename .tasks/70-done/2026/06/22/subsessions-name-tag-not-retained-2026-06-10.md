---
title: BUG — host name tag not retained in subsessions (spawn-child)
filed: 2026-06-10
source: operator testing (relayed via subsession sid 3 → Curator)
relates: tasks/10-drafts/10-2100-threaded-conversations-prd.md
status: draft / needs triage
severity: bug
---

## Report (operator, via subsession test 2026-06-10)

When spawning a subsession via `session/spawn-child`, the **host agent's name tag is not carried into the child session**. The operator wants the host's name tag inherited by the subsession.

## Observed
- Spawned child with `name: "subsessions"`; the child's onboarding reported topic **"Curator"** (parent inherited) rather than reflecting the requested name, and the host name-tag was not retained as expected.

## Code references (initial, unverified-deep)
- `src/tools/session/spawn-child.ts:90` — `runInSessionContext(childSid, () => { setTopic(\`${name} ${circleDigit}\`); })` sets the topic chip from the `name` param + circle digit.
- `src/tools/session/spawn-child.test.ts:103` — comment: "getSession returns undefined → inheritedName falls back to topic name 'Helper', inheritedColor = undefined" → name-inheritance path exists but may not retain the host name TAG.
- Likely gap: name-tag inheritance vs topic-name handling diverge; host `name_tag` is not propagated to the child.

## Ask
File + fix: the spawned child should inherit/retain the host agent's name tag (per operator). Confirm expected behavior with operator (full host name tag vs topic chip).
