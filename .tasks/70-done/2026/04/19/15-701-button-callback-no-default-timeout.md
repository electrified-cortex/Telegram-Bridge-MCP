# 15-701 - Button callbacks should not time out by default

## Context

Operator (2026-04-19) observed that question/choose/confirm callback buttons are timing out where they previously did not. Two-part observation:

- **Positive:** timeouts firing now means the recently-fixed callback handler is correctly responding to the timeout signal (regression fixed).
- **Negative:** there shouldn't be a default timeout at all. Callback buttons should hold open indefinitely (or for a very long, server-policy-driven default), not 60s as currently shipped in `send` schema.

Current state (`mcp__telegram-bridge-mcp__send`): `timeout_seconds` for question type defaults to **60s**, max **300s**. That cap defines the longest a Curator can wait for a button reply, which is wrong - the operator is allowed to take ten minutes to read and tap.

## Acceptance Criteria

1. **Default behavior:** when an agent does not pass `timeout_seconds`, callback buttons hold open indefinitely (or until the message is replaced/edited away).
2. **Optional explicit timeout** still honored when caller passes a value.
3. **Server policy guard:** if "indefinitely" is operationally risky (zombie ask handles), introduce a high server-side ceiling (e.g. 1 hour) configurable per session profile, not baked into the send schema's `max`.
4. Update `send` schema description for `timeout_seconds` to reflect new default.
5. Document the change in TMCP changelog.

## Investigation hooks

- Verify the recent callback-timeout fix didn't accidentally introduce stricter timeout enforcement.
- Check whether `confirm/yn`, `confirm/ok-cancel`, `choose`, and `ask` all share the same default.
- Audit existing agent code for hardcoded `timeout_seconds` that should drop to default.

## Scope boundary

- Callback button (question/choose/confirm) timeout default only.
- Do **not** touch dequeue's `max_wait` (separate concern, separate ceiling).

## Delegation

Worker (TMCP). Curator stages, Overseer reviews, operator merges.

## Priority

15 - operator-facing UX defect. Frequent friction.

## Completion

Branch `15-701`, commit `b3e99fb`.

Changes: removed `.default()` from `timeout_seconds` in `ask.ts`, `choose.ts`, `confirm.ts`, `send.ts` schemas; raised `.max()` from 300 to 86400. Added `NO_TIMEOUT_CEILING_SECONDS = 86_400` in `button-helpers.ts` with `timeoutSeconds: number | undefined` signatures. `ask.ts` applies ceiling locally (`effectiveTimeout = timeout_seconds ?? 86_400`). `ConfirmArgs.timeout_seconds` updated to optional. Schema descriptions unified to "Omit to use the server maximum (24 h)." Changelog updated.

Build: tsc pass. Lint/test blocked (node_modules missing in worktree — Overseer to verify).
