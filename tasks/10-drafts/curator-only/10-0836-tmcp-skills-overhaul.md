---
id: 10-0836
title: TMCP bundled skills — massive overhaul; audit each against skill methodology, prune fluff, expand for usability
priority: 10
status: draft
type: architectural
delegation: any
needs: Curator-led; Sonnet+ for audits; multi-cycle
---

# TMCP bundled skills — massive overhaul

Operator (2026-04-25): "massive skill overhaul... we need to use our own skill methodology and apply it properly to this stuff, because I think a lot of it is trash... how much of it is really a skill that's helpful? ... do we need to expand the suite of skills? Is the help enough? Is this just extra fluff? How much actually needs to be there as a skill until they're finally using the actual thing? What about setup as a skill? What about all the things that make it fluid for people to use?"

## Problem

The `skills/` folder bundled inside TMCP grew organically. Some entries are real skills that pass our methodology (spec → uncompressed → SKILL); some are documentation pretending to be skills; some are obsolete. There has been no end-to-end audit of the suite using our own skill-methodology criteria.

## Goals

1. **Audit every bundled skill** against the electrified-cortex skill-writing/skill-auditing methodology. Verdicts: KEEP, REWRITE, REMOVE, or RELOCATE.
2. **Prune fluff.** If something is just documentation that the `help` tool already covers, remove the skill folder and trust `help`.
3. **Expand for usability.** Identify gaps where a *new* skill would smooth out a common user flow:
   - **Setup-as-skill** — first-time install + auth + bridge start, cleanly dispatched. Operator explicitly named this.
   - **First-session orientation** — the post-startup discovery flow that operator's been refining throughout 7.2.
   - Anything else discovered during the audit.
4. **Consistency** — every retained skill must follow the spec/uncompressed/SKILL structure, pass skill-auditing, and not embed workspace-workflow assumptions (per `feedback_task_engine_repo_hygiene` and the parallel `10-0835` profiles concern).

## Scope (multi-cycle)

This is too large for one session. Slice it:

### Phase 1 — Inventory + verdict pass

For each `skills/<name>/` (and `skills/- <category>/<name>/`):
- Read the SKILL.md.
- Check for spec.md + uncompressed.md presence.
- One-line verdict: KEEP / REWRITE / REMOVE / RELOCATE.
- Note: which methodology violations apply (workspace leak, no spec, ambiguous classification, fluff that `help` covers).

Output: `agents/curator/temp/tmcp-skills-inventory.md` (or in repo as a planning doc).

### Phase 2 — Methodology audits

Skills marked KEEP or REWRITE go through the audit pipeline (spec audit → uncompressed audit → compress → SKILL audit). Drives changes; commits per skill.

### Phase 3 — Gap fills

Author specs for new skills (setup, orientation, others). Run the spec → uncompressed → SKILL pipeline.

### Phase 4 — Index regen

Rebuild `skills/skill.index` + per-category indexes after the dust settles.

## Acceptance criteria (final, end of all phases)

- Every skill in `skills/` passes skill-auditing.
- No workspace-workflow leakage (validate against pre-commit hook + the leakage-triple-check audit).
- `help` covers everything previously documented in REMOVED skill folders.
- A `setup` skill exists and works end-to-end on a fresh machine.
- A short `skills/README.md` explains what's there and the curation policy.

## Don'ts

- Do NOT do this in a single dispatch. Phase 1 inventory must run first; subsequent phases are operator-approved per skill.
- Do NOT remove anything without confirming `help` covers it (or filing the help addition first).
- Do NOT introduce a meta-skill that just lists the others — the index already does that.
- Do NOT couple to workspace-specific stages. TMCP skills must work in any consumer's workflow.

## Related

- `10-0835` — profiles/ folder relocation (parallel concern: also workflow-leaky).
- `feedback_task_engine_repo_hygiene` (Curator memory) — public-intent, zero leakage.
- `skill-writing` / `skill-auditing` (electrified-cortex) — methodology source.

## Branch

`10-0836` off `dev`. Phases will spawn child branches.
