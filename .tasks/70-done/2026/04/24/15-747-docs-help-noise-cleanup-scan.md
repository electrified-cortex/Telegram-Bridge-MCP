# 15-747 - Docs / help / service-message noise scan + cleanup

## Context

Operator wants a broader cleanup pass after 05-746 (PIN/token-format noise removal): **scan every agent-facing surface for text that reads as noise rather than signal and cut it.** Noise here includes implementation details leaking into descriptions, over-explanation, historical context left in current docs, repeated caveats, and anything that would *distract* an agent more than it helps when delivered via a hint, a help topic, or a service message.

A human reader tolerates context; an LLM agent budgets tokens against it. Every line in a help string, a service message, a tool description, or a nudge competes for attention. The scan is about deleting text, not rewriting it.

## Acceptance Criteria

1. Surfaces in scope:
   - `docs/` — every `.md` reachable from help topics or linked from SKILL/agent files
   - `docs/help/` — topic responses served by `help(topic: '...')`
   - `src/tools/*.ts` tool descriptions (the `description` field on schemas)
   - `src/service-messages.ts` — every event constant's `text`
   - `src/behavior-tracker.ts` nudge messages
   - Any other string passed to operators or agents as guidance
2. Identify and report (as commits with before/after):
   - Implementation details exposed to callers that don't influence caller behavior
   - Redundant restatements (same fact across three paragraphs)
   - "Background" or "History" sections inside guidance meant for in-the-moment reading
   - Defensive hedging that adds caveats but not decisions ("you might want to consider sometimes…")
   - Formulaic boilerplate that every description shares and contributes no per-tool info
3. Preserve: security rationale, concrete examples that change behavior, warnings tied to footguns.
4. Output delivered as one PR into dev (separate from 05-746), with a short summary of categories cut and total bytes/tokens shaved.

## Constraints

- Zero behavior changes. No code logic, no test edits beyond text assertions that reference trimmed strings.
- Each deleted paragraph gets a 1-line commit message justifying the cut (so reviewers can push back).
- If a deletion is uncertain, leave it and flag in the PR description — reviewer decides.
- Branch off dev. Do not merge without operator approval.

## Priority

15 - quality cleanup. Not blocking release. Valuable for agent token economy and clarity.

## Delegation

Worker (TMCP). Prerequisite: 05-746 must land first (so the scan doesn't re-cover already-cut ground).

## Related

- 05-746 (targeted parent: PIN/token-format noise — same class of problem, narrower scope)
- Memory `feedback_compression_as_talent.md` (compression discipline applies to source text too)
- Memory `feedback_tmcp_code_quality.md` (don't embed long strings in code; constants + help docs for nuance)
