---
created: 2026-06-20
resolved: 2026-06-22
status: done
priority: 10
source: comms-hardening-tomorrow.md R4 (Unit-12 analysis)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Chore
agent_type: Curator
model_class: sonnet-class
reasoning_effort: medium
executor: Helper (2026-06-22T23:42Z)
result: "Files were identical — no merge needed. TMCP local copy replaced with stub pointing to canonical stations path. All 4 pods (Curator, Overseer, ZL, Unit-12) confirmed pointing to stations canonical. TMCP stub staged in git."
---

# 10-0007 — Reconcile divergent telegram-participation SKILL.md

## Background

Two divergent copies of `telegram-participation/SKILL.md` exist:
1. `electrified-cortex/stations/skills/telegram-participation/SKILL.md`
2. `electrified-cortex/Telegram-Bridge-MCP/skills/telegram-participation/SKILL.md`

The TMCP-side copy is currently more up to date (recent edits there were not mirrored to stations).
Multiple pods (Curator, Overseer, Unit-12, ZL) load this skill — it's unclear which copy each actually resolves.

## Objective

Establish ONE canonical source of truth for `telegram-participation/SKILL.md` and ensure all pods
load the correct version.

## Steps

1. **Diff** the two copies — produce a unified view of all divergences
2. **Decide canonical home** — the stations version (shared skills repo) should be the authority;
   the TMCP-local copy should either be deleted or converted to a redirect/alias
3. **Merge** any TMCP-side improvements into the stations canonical version
4. **Audit** which pods (Curator, Overseer, Unit-12, ZL) actually load which copy — check their skills
   indexes and CLAUDE.md skill paths
5. **Fix** any pod that loads the stale/wrong copy — update its skills index to point to canonical
6. **Verify** via SHA-check or diff that all pods now load the same version

## Acceptance Criteria

- [ ] Single canonical `telegram-participation/SKILL.md` identified (stations recommended)
- [ ] All improvements from TMCP-local copy merged into canonical
- [ ] TMCP-local copy removed or converted to stub pointing at canonical
- [ ] All 4+ pods (Curator, Overseer, Unit-12, ZL) confirmed loading canonical version
- [ ] No functional regression for any pod's Telegram session startup

## Scope boundary

- Skill content reconciliation only — no new features in the skill
- Pod CLAUDE.md / skills indexes updated if needed to point at canonical
- No changes to `telegram-participation` behavior spec

## Delegation

Executor: Curator / Reviewer: Overseer

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — ACs are binary and checkable (diff, canonical decision, merge, audit, fix, SHA-verify); scope bounded (reconciliation only, no new behavior); delegation correct (Curator is the skill custodian); no open questions. Curator self-authorizes skill changes on shared repos.
