---
id: 10-0869
priority: 10
created: 2026-05-04
delegation: Worker
project: telegram-mcp
status: draft
target_release: 7.4
---

# Custom name tags

## Summary

A session's "name tag" is currently auto-built from `color-emoji + robot-emoji + session-name`. Refactor: name tag becomes a **single editable string** the operator (or any agent) can change at any time. Default on session start stays simple — `<color-emoji> <name>` (no robot emoji). When formatted in outbound messages it is wrapped in monospace.

## Behavior

- Name tag is a single string field on the session, free-form.
- On `session/start`: name tag is set to the default — `<color-emoji> <name>` — UNLESS profile-load supplies a stored custom name tag (then that overrides).
- New action(s): set the name tag to any string the caller supplies. Could be a single emoji (`💃`), plain text (`Lawnmower`), text + emoji (`Lawnmower 💃`), or anything else.
- After change: outbound messages from that session use the new name tag. Confirmation flow ("how does this look?") is up to the agent driving the change.
- Optional: prompt to save the new name tag to the session's profile if a profile exists.

## Default change — eliminate robot emoji

The robot emoji default (`🤖`) is removed from the auto-name. New default = `<color-emoji> <name>`. Two characters less, less emoji fatigue. Existing sessions retain whatever they currently have until the operator changes them.

## Profile integration

- Profiles MAY store a `name_tag` field.
- Saving the profile only writes `name_tag` if a CUSTOM name tag is set (i.e. it differs from the auto-default OR an explicit set action fired). If the session is using the auto-default, profile save does NOT include `name_tag`.
- On profile load: if `name_tag` is present in the profile, it overrides the session's current name tag.
- Selective save (operator can opt out of saving the name tag with the profile) — out of scope for first pass; revisit if needed.

## TDD note

Strong TDD candidate. Existing name-tag code has accumulated funky logic — write tests for each subtask FIRST, refactor against tests, ensure no regressions in outbound rendering. Each subtask below has its own test file.

## Subtasks

Sequential where dependent; mark which can parallelize. Each subtask is small enough to claim independently if delegation supports it.

**1. Refactor name-tag storage to single string** *(blocks all others)*

- Replace any composite name-tag struct (color/emoji/name) on the session model with a single `name_tag: string` field.
- Internal helper `defaultNameTag(session) → string` computes `<color-emoji> <name>`.
- All read sites pull from `session.name_tag` (or fall to `defaultNameTag` if unset).
- Tests: unit tests for storage round-trip and default fallback.

**2. Drop robot emoji from default** *(parallel with #3)*

- Update `defaultNameTag` to omit `🤖`. New default = `<color-emoji> <name>` separated by single space.
- Existing sessions retain their stored tag — no migration.
- Tests: assert default does not contain `🤖`.

**3. New action `name-tag` (jQuery-style get/set)** *(parallel with #2)*

- `action(type: "name-tag", token)` — getter, returns `{ name_tag: <current> }`.
- `action(type: "name-tag", token, name_tag: "<new>")` OR `action(type: "name-tag/set", token, name_tag: "<new>")` — setter, overrides session's name tag.
- One action namespace, two shapes (jQuery pattern: same name, parameter presence determines mode).
- Validation: max 64 chars, no newlines.
- Applies immediately; subsequent outbound uses new tag.
- Returns `{ name_tag: <applied> }` on set; returns `{ name_tag: <current> }` on get.
- Tests: get returns current, set overrides, get-after-set returns new value, validation rejects oversized/newlines.

**4. Outbound rendering monospace wrap** *(after #1)*

- Wherever the name tag prefixes outbound messages, wrap in monospace (` `` ` backticks).
- Tests: outbound from session with `name_tag = "Lawnmower"` renders as `` `Lawnmower` `` prefix.

**5. Profile save: conditional `name_tag`** *(after #1, #3)*

- `profile/save` (or equivalent) serializes `name_tag` ONLY if the session has an explicit custom tag set (i.e. tag differs from `defaultNameTag(session)` OR an explicit set fired).
- Tests: save with default → no name_tag in profile; save after set → name_tag included.

**6. Profile load: apply `name_tag`** *(after #1, #5)*

- `profile/load` applies `name_tag` if present in the profile, overriding session default.
- Tests: load profile with name_tag → session uses it; load without → default holds.

**7. Curator dogfood** *(after #1–#6 land)*

- Curator session: set custom tag, verify outbound, save profile, close session, restart, verify reload applies tag.
- Documented in PR description.

## Acceptance criteria

- [ ] All 7 subtasks land with tests passing.
- [ ] Outbound rendering uses current name tag, monospace-wrapped.
- [ ] New sessions default to `<color-emoji> <name>` — robot emoji removed.
- [ ] Profile save serializes `name_tag` only when custom set.
- [ ] Profile load applies `name_tag` if present, overriding default.
- [ ] Existing sessions with legacy default keep working until explicitly changed.
- [ ] Curator dogfood passes end-to-end.
- [ ] **Merge target: 7.4 release branch.**

## Completion

**Verdict: NEEDS_REVISION** — 2026-05-05
Verified by: Overseer dispatch (Sonnet verifier)

**Verdict: APPROVED** — 2026-05-06 (round 2)
Verified by: Overseer dispatch (Sonnet verifier)
Both gaps resolved:
- Gap 1: apply.test.ts (3 tests) + load.test.ts (2 tests) — name_tag branch fully covered
- Gap 2: docs/dogfood/10-0869-name-tags.md — complete end-to-end walkthrough, 104 lines
All 8 ACs satisfied. Ready to seal.

### Passing (5/7 subtasks)
- AC1/ST1 ✅ Storage refactor — `Session.name_tag?` field, `defaultNameTag()` helper, round-trip tests
- AC1/ST2 ✅ Robot emoji dropped — `defaultNameTag` returns `<color> <name>`, test asserts no `🤖`
- AC1/ST3 ✅ `name-tag` action (get/set) — `src/tools/name-tag.ts`, 145-line test suite
- AC1/ST4 ✅ Monospace wrap — `buildHeader` backtick/`<code>` wrapping, outbound-proxy tests
- AC1/ST5 ✅ Profile save conditional — `if (session.name_tag !== undefined)` guard, both branches tested
- AC2 ✅ Outbound uses current name tag, monospace-wrapped
- AC3 ✅ New sessions default to `<color> <name>`, no robot emoji
- AC4 ✅ Profile save serializes only custom-set `name_tag`
- AC6 ✅ Legacy sessions fall back to `defaultNameTag`, no migration

### Gaps (blocking)

**Gap 1 — AC5 / ST6: Profile load tests missing**
`apply.test.ts` has no mock for `getSession` and zero tests for the `name_tag` branch.
`load.test.ts` has no test that loads a profile containing `name_tag` and verifies the session field is updated.
Spec TDD mandate: "Tests: load profile with name_tag → session uses it; load without → default holds."
Implementation (`apply.ts`) is correct; test coverage is absent.

**Gap 2 — AC7 / ST7: Curator dogfood not documented**
Merge commit `e1917141` into `release/7.4` has only a subject line.
No end-to-end walkthrough (set tag → verify outbound → save profile → close → restart → verify reload) appears in the commit history or PR body.
Spec requires: "Documented in PR description."

### Required fixes
1. Add tests to `apply.test.ts`: mock `getSession`, assert `session.name_tag` is set from profile; assert no `name_tag` when profile omits it.
2. Add tests to `load.test.ts`: load with `name_tag` → session updated; load without → default holds.
3. Document the dogfood walkthrough — either append to the PR description or add as a `docs/dogfood/10-0869-name-tags.md` file and commit.

## Out of scope

- Selective profile save (skip name tag opt-out at save time) — defer.
- Migration script for existing stored profiles — defer; new profiles use new shape.
- Validation/sanitization of name tag content (e.g. length cap, banned chars) — apply only obvious safety: no newlines, max length sane (e.g. 64 chars).

## Notes

- "Funny business" with name tags has been a recurring pain point — refactor explicitly aims to flatten the logic.
- Operator framing: "the name tag is just a string of text, that's all it is, end of story."
- Two 7.4 features: `activity/file` (already shipped, 50-0868) + this.
