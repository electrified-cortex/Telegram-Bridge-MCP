# TMCP v7.6 release decision — operator 2026-05-24

**Source:** operator voice msg 60548 (2026-05-24 ~17:43 PT)

## Verbatim

> "I'm contemplating that I think I want to ship what we have as is as version 7.6, which is going to basically be the same, probably the same code that gets released in version 8. Version 8 will actually be where we actually have all the skills and the skills plugins set up correctly. But for now, I just want it as is, with the features to be consumed."

## Distilled decision

- **v7.6** = current `dev` branch state, shipped AS-IS. Goal: get the existing features into assistants' hands now.
- **v8** = same code base, but with the **skills + skills-plugins** layer properly built out on top. Not a code rewrite — a skill-ecosystem layer.
- The split is: ship the infrastructure now (v7.6), polish the skill layer for v8.

## What this implies for the current spec backlog

- The `spawn-child-service-message-chain-2026-05-24.md` spec I just filed: per operator's earlier directive ("last feature I want in TMCP before release"), this lands BEFORE v7.6 if the swarm passes it. Otherwise it slips to v7.7 or v8.
- Sub-session presentation cleanup (`sub-session-presentation-cleanup-2026-05-22.md`) with 13 Overseer bounces: NOT blocking v7.6 unless operator explicitly says so. Likely v7.7 or v8.
- Governor-split (`governor-split-with-unskilled-breadcrumb-injection-2026-05-23.md`): DEFERRED. v8 territory at earliest.

## Action items

1. After swarm verdict on spawn-child spec:
   - If PASS: implement, merge to master, tag v7.6.
   - If NEEDS-REVISION: iterate spec to v0.2, re-swarm, then implement.
2. Curator drafts release notes for v7.6 covering all 40 commits already in dev (esp. shipped breadcrumb chain + activity/file/touch + reminder fixes).
3. Operator approves release notes + tag.
4. Sub-session presentation + governor-split stay in `10-drafts` for v8 cycle.
