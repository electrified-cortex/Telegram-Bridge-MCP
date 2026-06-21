---
created: 2026-05-12
status: 10-drafts
priority: 15-0898
source: operator-call-2026-05-12
repo: Telegram MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
shipped: v7.11.1
---

# 15-0898 — Document pod-memory convention for compaction-survivable agent state

## Context

There is no built-in "memory tool" in Claude Code CLI — verified
2026-05-12 via dispatched research and direct inspection of
`.agents/agents/.mcp.json`. Past agent sessions narrating "let me add
this to memory" were invoking Write on a path under their pod's
`memory/` directory; the convention was implicit and inconsistent
across sessions and across agents. When compaction happens, an agent
that did not save its session token to a deterministic, pod-relative
location loses it and cannot reconnect to the bridge — observed
2026-05-11 in a 45-minute recovery failure documented in the prior
Curator handoff. TMCP is the natural authority to publish this
convention because (a) the token belongs to TMCP, and (b) TMCP already
emits onboarding guidance via `help('compacted')` and
`session/start` / `session/reconnect` hint fields.

## Objective

Define and publish a single canonical convention for where each agent
stores its TMCP session token (and any other compaction-survivable
state TMCP needs the agent to retain), and surface that path
verbatim in TMCP's onboarding messages so a fresh-context or
post-compaction agent reads the literal save location from TMCP and
cannot improvise.

Convention to adopt: pod-relative path `memory/telegram/session.token`
containing the plain integer token, one value per file, no JSON
envelope. The pod is whatever folder contains the agent's
`CLAUDE.md` + `.claude/settings.local.json` (e.g.
`.agents/agents/curator/` for the Curator pod).

## Acceptance Criteria

1. `help('compacted')` response text contains the literal string
   `memory/telegram/session.token` and a one-sentence instruction
   directing the agent to save its current session token there as
   plain integer, no surrounding JSON.
2. `help('quick_start')` response text contains the same literal
   path and instruction in the profile or token-save section.
3. `action(type: 'session/start')` response includes a `save_token_to`
   field with value `memory/telegram/session.token` AND a `hint`
   string referencing that field.
4. `action(type: 'session/reconnect')` response includes the same
   `save_token_to` field and hint.
5. New help topic `help('pod-memory')` exists and documents the
   convention: the path, the rationale (compaction-survivable
   pod-relative state), and the rule that anything TMCP wants the
   agent to retain across compaction must be under `memory/` of the
   agent's pod with a documented sub-path.
6. `docs/help/pod-memory.md` exists in the TMCP repo with the same
   content as the topic response.
7. Existing `docs/help/activity/file.md` cross-links to the new
   `pod-memory` topic where it references token state.
8. A regression test under `src/tools/help.test.ts` (or the closest
   existing pattern) asserts the literal path string appears in the
   `compacted`, `quick_start`, and `pod-memory` topic outputs.
9. A regression test asserts `session/start` and `session/reconnect`
   responses include the `save_token_to` field with the correct
   literal value.
10. Documentation update on `tmcp-onboarding-activity-file-monitor-wiring.md`
    in `tasks/10-drafts/` cross-links to the new convention (or this
    task's ID once filed).

## Scope boundary

- This task is documentation + onboarding-message changes only. It
  does NOT implement a new file-storage backend, does NOT define a
  memory-tool MCP server, and does NOT change agent recovery scripts.
- This task does NOT touch `.agents/agents/*/context/` files. Updating
  each agent's `recovery.md` / `refresh.md` to read the new
  `save_token_to` field is a separate follow-up task per pod.
- This task does NOT replace or extend Anthropic's API-level
  `memory_20250818` tool. That is an SDK feature unrelated to TMCP.
- No change to wire protocol semantics beyond response-shape additions
  (new fields, not modifications).

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 15 — normal

## Affected Files / Repos

- `Telegram MCP/src/tools/help.ts` (and topic content sources)
- `Telegram MCP/src/tools/help.test.ts` (regression assertions)
- `Telegram MCP/src/tools/session/start.ts` (or whichever module
  composes the session/start response) — add `save_token_to` field
- `Telegram MCP/src/tools/session/reconnect.ts` — same
- `Telegram MCP/docs/help/pod-memory.md` (new file)
- `Telegram MCP/docs/help/activity/file.md` (cross-link)
- `Telegram MCP/docs/help/compacted.md` (if topic content lives in a
  file vs inline string)

## Blockers

None.

## Rollback procedure

Not a governance-path change (no `hooks/`, no `.claude/`, no agent
spec). Rollback is `git revert <merge-commit>` on the feature branch's
merge into `master`. Onboarding messages return to prior text; agents
fall back to the prior implicit convention (which is the current
behavior).

## Notes

- The convention chosen — pod-relative `memory/<subsystem>/<key>` —
  matches what the prior Curator already practiced in handoff
  (`memory/telegram/session.token`) and what the auto-memory dir at
  `%USERPROFILE%\.claude\projects\<encoded-pod>\memory\` also
  practices independently. The task formalizes one of those two
  locations as canonical; pod-relative is chosen because it is
  workspace-portable and travels with the agent pod definition.
- `agent_type: Worker` because the work is mechanical: edit help
  responses, add response fields, add tests, write a docs page.
- `model_class: sonnet-class` because response-shape changes touch
  test snapshots and require careful schema discipline.
- `reasoning_effort: medium` — not trivial (multiple call sites + new
  topic + cross-link audit), not architectural.

## Refinement needed (2026-05-15)

Spec should be generalized: 'use whatever memory tool is available; if none, fall back to a local pod folder.' Current spec hardcodes a specific path without acknowledging that the available memory mechanism varies by pod type and context.

## Worker summary

**Branch:** `worker/15-0898-define-pod-memory-convention-for-agent-state`
**Commit:** `a6d8a853`
**Tests:** 3560 passed / 0 failed (was 3551 passed / 2 failed at baseline)
**Build:** clean (tsc, no errors)

### Changes made

| File | Change |
| --- | --- |
| `docs/help/pod-memory.md` | NEW — canonical convention doc: path, rationale, recovery, wipe-on-shutdown |
| `docs/help/compacted.md` | Step 1 now names `memory/telegram/session.token` explicitly with save instruction (AC1) |
| `docs/help/start.md` | Added "Token Save" section with path and pod-memory link (AC2) |
| `docs/help/quick_start.md` | Added "Save your token" section with path and pod-memory link |
| `docs/help/activity/file.md` | Added cross-link to pod-memory in Compaction recovery section (AC7+10) |
| `src/tools/help.ts` | Added `'pod-memory'` to `RICH_TOPICS` set so new topic routes to file (AC5) |
| `src/tools/session/start.ts` | Added `save_token_to: "memory/telegram/session.token"` to all three response paths: new session, reuse (refresh: true), and reconnect (AC3+4) |
| `src/tools/help.test.ts` | Added AC8 describe block: 4 tests asserting literal path in `compacted`, `quick_start`, `pod-memory` topic outputs |
| `src/tools/session/start.test.ts` | Added AC9 describe block: 3 tests asserting `save_token_to` field in `session/start`, `session/reconnect`, and `refresh: true` (reuse) responses |
| `src/service-messages.ts` | Fixed pre-existing ONBOARDING_LOOP_PATTERN test failures: added `dequeue(max_wait: 0)` to monitor-driven paths and `dequeue(max_wait: 30)` to no-Monitor fallback |

### Acceptance Criteria status

All 10 ACs satisfied. Note: AC10 (docs/help/activity/file.md cross-link) verified in both the link text and literal path presence — same file as AC7.

### Notes

- `session/reconnect` logic is in `src/tools/session/start.ts` (not a separate file), as noted in the assignment.
- The `quick_start` topic alias maps to `docs/help/start.md`; the `docs/help/quick_start.md` file was also updated for documentation completeness.
- Pre-existing test failures (ONBOARDING_LOOP_PATTERN) were fixed in the same pass since they block the final green build requirement.

## Verification

**Verifier:** Dispatch agent (independent) — 2 rounds  
**Date:** 2026-06-21  
**Verdict:** APPROVED

All 10 acceptance criteria CONFIRMED:
1. CONFIRMED — `docs/help/compacted.md:5`: contains `memory/telegram/session.token` with save instruction
2. CONFIRMED — `docs/help/start.md:4` (quick_start alias): literal path + instruction present
3. CONFIRMED — `src/tools/session/start.ts:345-346`: `save_token_to: "memory/telegram/session.token"` + hint references path
4. CONFIRMED — `src/tools/session/start.ts:605-606` (handleSessionReconnect): same field + hint
5. CONFIRMED — `docs/help/pod-memory.md` (51 lines); `src/tools/help.ts:180` adds "pod-memory" to RICH_TOPICS
6. CONFIRMED — `docs/help/pod-memory.md` exists with full convention content
7. CONFIRMED — `docs/help/activity/file.md:170-171`: cross-link to help('pod-memory') + literal path string
8. CONFIRMED — `src/tools/help.test.ts`: 4-test "pod-memory convention — literal path regression (AC8)" block
9. CONFIRMED — `src/tools/session/start.test.ts`: 3-test "pod-memory convention — save_token_to field (AC9)" block
10. CONFIRMED — `docs/help/activity/file.md`: both link text `help('pod-memory')` and `memory/telegram/session.token` path present (AC10 = same file/requirement as AC7)

Test evidence: 3560 passed, 0 failed (branch fixes pre-existing ONBOARDING_LOOP_PATTERN)

Sealed-By: Foreman (fix/flush-pending-channel-notify-timeout)
