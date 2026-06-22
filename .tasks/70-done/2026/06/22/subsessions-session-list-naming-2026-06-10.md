---
title: BUG — subsessions show in session list as exactly the host name (no index marker)
filed: 2026-06-10
source: operator testing (Telegram, msg 71023)
relates: tasks/10-drafts/10-2100-threaded-conversations-prd.md
status: draft / needs triage
severity: bug (V8 polish)
---

## Report (operator, 2026-06-10)

Subsessions appear in the user/session list as **exactly the host name** (e.g. "Curator"), with nothing to distinguish them from the parent. They should at least have a **"(1)" / circle-digit** marker next to the name.

## Initial analysis (Curator)
- `src/tools/session/spawn-child.ts:90` sets the **topic chip** to `\`${name} ${circleDigit}\`` (e.g. "Curator ①") — so the TOPIC chip carries the digit.
- BUT the child session's **display name** (what shows in the session list) inherits the parent name without the digit (`spawn-child.test.ts:103`: "inheritedName falls back to topic name"). So the session-list entry reads just "Curator".
- Gap: the slot index/marker is applied to the topic chip but NOT to the session-list display name.

## Ask
Apply the slot index/marker (e.g. " ①" or "(1)") to the subsession's **session-list display name**, not only the topic chip — so subsessions are visually distinct from the host in the session list. Confirm desired format with operator (circle digit vs "(N)").

## Note
3rd subsession bug from 2026-06-10 testing (with name-tag-not-retained + topic-enforcement). Feeds the threaded-conversations / V8 polish.
