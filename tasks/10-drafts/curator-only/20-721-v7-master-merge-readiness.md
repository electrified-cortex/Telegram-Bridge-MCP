# 20-721 - V7 → master merge readiness audit

## Context

Operator (2026-04-19, voice 38225): "We've done a lot of fixes. We need to start thinking about merging V7 into master. The build is passing. ... Maybe dispatch a background Sonnet agent to consider what about the README needs to be updated, and how are we doing on auditing the help."

Translation: V7 dev branch has accumulated enough fixes that it's worth shipping to master. Before doing so, two surface-level items need an audit:

1. **README**: does it reflect V7's current behavior? (New features, changed defaults, removed/renamed options.)
2. **Help topics**: are `help('compression')`, `help('audio')`, `help('send')`, etc. still accurate against current behavior? (15-713 already flagged some staleness; see if anything else has drifted.)

If both come back clean (or with small diff-able fixes), patch them in V7 and merge to master. If either reveals significant drift, file a follow-up before merging.

Operator's framing also implied: "if anything is a quick fix, push it up" — i.e. small bugs that block merge confidence should be patched in V7 directly, not deferred.

## Acceptance Criteria

1. **Dispatch Sonnet audit** with two targeted questions:
   - "What does the README at `Telegram MCP/README.md` (current v7 dev branch state) say that no longer matches the actual MCP behavior? List concrete diffs."
   - "Walk every `help(...)` topic in TMCP and check it against the current code. Report any topic that's stale, misleading, or contradicts a recently-shipped behavior change."
2. **Triage the audit output:**
   - Trivial doc fixes → patch on dev branch immediately.
   - Substantive design issues → file as separate tasks; merge V7 anyway if those issues predate V7.
3. **Verify build is green** on dev (and CI if applicable).
4. **Promote dev → master** via a single explicit PR. Operator merges (per `feedback_no_merge.md` Curator never merges to master).
5. **Tag** the merge commit on master with the V7 version label per project convention.

## Constraints

- Don't merge V7 → master without operator approval, even if all checks pass. Curator stages; operator merges.
- Don't bundle unrelated work into the merge PR. Keep it scoped to "ship V7 as it stands + the audit-driven doc fixes."
- Don't audit every line of code — limit to README and help topics, which is what the operator asked for.

## Open Questions

- Is there a specific changelog format the V7 release commit should use? (Check prior version-bump commits.)
- Are there pending TMCP-dev PRs (15-713/14, 20-715/16, 10-719/720) that should land on dev first, or merge V7 with what's already there and let the new tasks land on a future branch?

## Delegation

Curator orchestrates: dispatches the Sonnet audit, triages output, files follow-ups, opens the merge PR. Worker (TMCP) handles any quick patches surfaced by the audit. Operator merges to master.

## Priority

20 - quality / shipping cadence. Not blocking active work; ships accumulated value.

## GPT-5.4 Audit Findings (2026-04-19)

External audit run by operator. Build green, 2441 tests pass across 115 files, lint **fails** on 3 unused-vars errors. Findings filed as separate actionable drafts:

- **05-722** (BLOCKER) — fix lint: unused `args` parameter in `unknown-param-warning.test.ts:210/219/229`.
- **10-723** — `help.ts` content drift (3 places: startup/quick_start, list_sessions probe, approve_agent ticket).
- **10-724** — `action.ts:230` token schema description omits token-optional `session/list` path.
- **10-725** — tutorial control surface (`action.ts:192-202` + `session-manager.ts:376/393`) is a no-op; wire it or delete it.
- **15-726** — finish `docs/behavior.md` -> `docs/guide.md` rename cleanup (4 stale references).
- **20-727** — `action.ts:207` still brands itself "v6 API" in a v7 release.
- **30-728** — `checklist.md:16` fence missing language tag.

**Merge gate:** 05-722 MUST land before merge. 10-723 / 10-724 / 20-727 strongly recommended (public API surface). 10-725 is a design decision that can defer if time-pressed. 15-726 and 30-728 are nice-to-have cleanup that can ride on the next dev cycle.

## Related

- Audit-derived tasks: `05-722`, `10-723`, `10-724`, `10-725`, `15-726`, `20-727`, `30-728`.
- All open TMCP dev tasks: `15-713`, `15-714`, `20-715`, `20-716`, `10-719`, `10-720`.
- Memory `feedback_no_merge.md` (Curator never merges to master).
- Memory `feedback_commit_review.md` (don't commit to own repo without operator review — applies to merge commit).
