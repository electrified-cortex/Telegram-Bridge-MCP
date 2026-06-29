# Task: TMCP PR #258 — Audio-Remap BK-1, BK-3, W-6 Fixes

**Branch:** dev (HEAD: cc7492da)
**Delegation:** electrified-cortex/Telegram-Bridge-MCP foreman

## Background

PR #258 adversarial review (2026-06-29) found three issues in `src/tools/profile/audio-remap.ts` and its tests. This task fixes BK-1 (null guard), BK-3 (case-insensitive key design), and W-6 (test fixture rule violations). BK-2 (multi-chunk table bypass) is handled separately pending Curator design decision.

## Problem

**BK-1 — Missing null guard on word/replacement**
`handleAudioRemapSet` accepts `word` and `replacement` typed as `string` in the function signature, but the MCP tool schema marks them `.optional()`. If undefined values slip through schema validation, `word` could be `undefined`, silently storing key `"undefined"` in `session.audio_remapping`. Same risk for `replacement`.

**BK-3 — Case-sensitive key storage contradicts design intent**
`handleAudioRemapSet` stores keys verbatim (e.g., `"Nginx"` ≠ `"nginx"`). `handleAudioRemapRemove` uses `word in session.audio_remapping` (strict case match), so `remove("nginx")` silently fails if stored as `"Nginx"`.

**Confirmed design (operator 2026-06-29):**
- Default: normalize word to lowercase on `set` and `remove`
- Exception: if two entries have the same letters (same normalized key) but carry **distinct phonetics** AND distinct original casing, store them separately (verbatim)

**W-6 — Test fixtures use proper names and phonetics**
`src/tools/profile/audio-remap.test.ts` (and any apply/save tests that reference these mappings) use real product names and phonetic spellings (nginx, engine-x, sql, sequel, api, ay-pee-eye, ssl, es-es-el). Harness rule: no proper names or phonetic strings in fixtures.

## Solution

### BK-1 — Add null/empty guard to handleAudioRemapSet

At the top of `handleAudioRemapSet`, before any key logic:

```typescript
if (!word || !replacement) {
  return toError({
    code: "INVALID_INPUT" as const,
    message: "word and replacement are required.",
  });
}
```

This catches undefined, empty string, and other falsy values regardless of schema validation.

### BK-3 — Case-insensitive key normalization

Replace the key storage and lookup logic in `handleAudioRemapSet` and `handleAudioRemapRemove`:

**handleAudioRemapSet — new key logic (after null guard, after session init):**

```typescript
const normalizedWord = word.toLowerCase();

// Case 1: exact key already stored (covers case-sensitive exception entries)
if (word in session.audio_remapping) {
  const previous = session.audio_remapping[word];
  session.audio_remapping[word] = replacement;
  return toResult({ word, replacement, previous, set: true });
}

// Case 2: normalized key exists
if (normalizedWord in session.audio_remapping) {
  const existingReplacement = session.audio_remapping[normalizedWord];
  if (word === normalizedWord || existingReplacement === replacement) {
    // Same phonetics, or word is already lowercase → update normalized key in place
    const previous = existingReplacement;
    session.audio_remapping[normalizedWord] = replacement;
    return toResult({ word: normalizedWord, replacement, previous, set: true });
  }
  // Different casing AND different phonetics → case-sensitive exception
  session.audio_remapping[word] = replacement;
  return toResult({ word, replacement, previous: null, set: true });
}

// Case 3: no existing entry → store as lowercase
session.audio_remapping[normalizedWord] = replacement;
return toResult({ word: normalizedWord, replacement, previous: null, set: true });
```

**handleAudioRemapRemove — normalize lookup:**

Replace `!(word in session.audio_remapping)` guard with:

```typescript
const normalizedWord = word.toLowerCase();
const effectiveKey =
  word in session.audio_remapping ? word :
  normalizedWord in session.audio_remapping ? normalizedWord :
  null;

if (!effectiveKey) {
  return toError({
    code: "NOT_FOUND" as const,
    message: `No audio remapping entry for "${word}".`,
  });
}

const previous = session.audio_remapping[effectiveKey];
const { [effectiveKey]: _removed, ...rest } = session.audio_remapping;
session.audio_remapping = Object.keys(rest).length > 0 ? rest : undefined;
return toResult({ word: effectiveKey, previous, removed: true });
```

### W-6 — Replace fixture names and phonetics

In all test files under `src/tools/profile/` (`audio-remap.test.ts`, and any apply/save test files that reference the same entries):

- Replace proper product names with generic synthetic words (e.g. `"zorp"`, `"flibble"`, `"quux"`)
- Replace phonetic spellings with generic multi-syllable strings (e.g. `"ZOR-pee"`, `"FLIB-ul"`, `"kyoox"`)
- Replacements must exercise the same code paths (varied casing, same-letters-different-phonetics for the exception path)
- No real product names, acronyms, or actual phonetic expansions anywhere in test fixtures

## Scope

- `src/tools/profile/audio-remap.ts` — BK-1 guard + BK-3 key logic (set and remove)
- `src/tools/profile/audio-remap.test.ts` — W-6 fixture replacements + tests for new key normalization behavior
- Any other test file referencing audio-remap fixture names (check apply.test.ts, save.test.ts)
- No changes to list handler, session types, or schema definitions

## Acceptance Criteria

- [ ] `set` with `word=undefined` or `replacement=undefined` returns `INVALID_INPUT` error (not a stored key)
- [ ] `set("Foo", "replacement")` stores key `"foo"` (normalized)
- [ ] `set("foo", "replacement")` after `set("Foo", "replacement")` with same phonetics: single entry at key `"foo"`, no duplicate `"Foo"` entry
- [ ] `set("Foo", "one")` then `set("FOO", "two")`: two entries stored (`"foo"` → `"one"` and `"FOO"` → `"two"`) because distinct phonetics, distinct casing
- [ ] `remove("Foo")` finds and removes `"foo"` (case-insensitive fallback)
- [ ] `remove("FOO")` finds and removes `"FOO"` (exact match when case-sensitive exception exists)
- [ ] No test fixture contains a real product name, acronym, or actual phonetic expansion
- [ ] `pnpm test` passes (all 4230+ tests green)
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Version bump to v7.22.8 in package.json + CHANGELOG entry
- [ ] Commit to `dev` branch with conventional commit message

<!-- overseer-gate: PASS 2026-06-29 -->

## Out of Scope

- BK-2 (multi-chunk table bypass) — awaiting Curator design decision
- W-1 through W-5, W-7 (other warnings) — not blocking this task
- Profile persistence or schema changes

## Verification

**Verdict:** APPROVED
**Verifier:** ab95e41de00e90674
**Date:** 2026-06-29
**Squash commit:** 4d0bf0c2
**Evidence:** 4238 tests pass (173 files), lint clean (eslint exit 0), build clean (tsc + gen-build-info exit 0)
**All 12 AC confirmed.** BK-1 null guard, BK-3 case normalization, W-6 fixture cleanup verified correct.
Sealed-By: foreman/036d928b
