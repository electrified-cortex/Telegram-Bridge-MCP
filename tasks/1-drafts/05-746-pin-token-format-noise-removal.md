# 05-746 - Remove PIN / token-format noise from docs/help/tool descriptions

## Context

Operator reviewed PR #151 and flagged that the legacy term **PIN** and the token-format formula (`sid * 1_000_000 + suffix` / `sid * 1000000 + pin`) are leaking into agent-facing surfaces where they serve no purpose. The token is opaque to agents — they receive it from `session/start` and pass it back on subsequent calls. The internal formula is implementation detail; agents do not construct tokens themselves. Exposing it in tool descriptions, help topics, and docs is noise that competes with the signal.

Memory record `telegram/token.md` is already marked DEPRECATED for the same reason.

## Acceptance Criteria

1. Tool descriptions in `src/tools/*.ts` no longer mention the token formula. Replace "Session token from action(type: 'session/start') (sid * 1_000_000 + suffix)" with "Session token from action(type: 'session/start')" — the formula adds nothing agents can use.
2. `src/session-gate.ts` line 38 hint: drop the formula line. Keep only the `"Example: token: 1000123456"` style if it helps; otherwise delete.
3. `docs/help/session/start.md` no longer says "Generates SID and PIN; returns token (sid*1000000+pin)." — rewrite to describe what the caller gets back (a token) without the formula.
4. `docs/communication.md` line 284: rephrase "SID/PIN" to "session token" or equivalent opaque reference.
5. `docs/multi-session.md`, `docs/multi-session-flow.md`, `docs/session-profiles.md`, `docs/multi-session-test-script.md`: replace user-visible PIN/SID-prefix language with opaque-token language wherever the formula is not load-bearing for the text's actual point. Where PIN genuinely matters as an internal concept (e.g. security rationale, session ownership), keep but rename to the current term (`suffix`).
6. Historical files stay untouched: `changelog/*.md` and `docs/multi-session-plan.md` record past design — do not rewrite history.
7. Do not rename the internal code variable `suffix` or the public token schema. This task is pure documentation/description hygiene.
8. Test files under `src/**/*.test.ts` that assert on token formulas continue to pass unchanged — the token math is still `sid * 1_000_000 + suffix` in code.

## Constraints

- Scope is text-only: tool descriptions, docs, help topics, service messages (if any reference formula). No code behavior changes.
- Worktree branch off dev. Small PR into dev.
- Must land before v7.0.1 release goes out, or as an immediate follow-on.

## Priority

05 - active PR blocker. Agent-facing hygiene on a release about to ship.

## Delegation

Worker (TMCP) on a dedicated worktree. Prerequisite for 15-747 (broader noise scan).

## Related

- PR #151 (TMCP v7.0.1, currently resolving merge)
- 15-747 (follow-on: docs/help/service-message noise scan — this task's broader cousin)
- Memory `telegram/token.md` (deprecated — same concern)
