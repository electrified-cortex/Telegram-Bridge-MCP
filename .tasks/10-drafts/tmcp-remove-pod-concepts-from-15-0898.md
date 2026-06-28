---
title: "Remove all pod-concepts from v7.11.1 — help docs + runtime service messages"
priority: urgent
type: fix
delegation: curator
dispatch_ready: false
created: 2026-06-21
updated: 2026-06-22
source: overseer-red-alert + full-diff-review
blocks: PR #219 (v7.11.1→master), PR #224 (v7.12.0→master)
related: .tasks/00-ideas/v8-tmcp-no-pod-concepts-2026-05-27.md
---

## Status — 2026-06-22 (updated)

**PRs #219 and #224**: MERGED ✅ (v7.11.1 and v7.12.0 landed in master)

**pod-memory.md**: DELETED (not renamed) — commit `42ce3447` removed the file entirely. Open question about rename is RESOLVED: it was deleted.

**Remaining violations in current codebase** (found 2026-06-22 dogfood audit):
- `src/tools/activity/listen.ts` line 59 — "your pod root or memory/ dir" (runtime string) ← IN MASTER
- `src/service-messages.ts` — same language, reintroduced by commit `3ad69ca2` on `release/7.13.0` ← NOT in master

These need to be fixed before 7.13.0 ships. Overseer has been briefed.

**v7.11.1 (merged via PR #225)**: Pod-concept fixes APPLIED ✅
- Violations #6 ACTIVITY_LISTEN_BREADCRUMB ✅ (commit 90d94a05)
- Violations #7 ONBOARDING_LOOP_PATTERN ✅ (commit 90d94a05)
- pod-memory.md DELETED (commit 42ce3447) ✅

# Remove pod-concepts introduced by 15-0898

## Background

Task 15-0898 ("define pod-memory convention for agent state") introduced pod-terminology violations into TMCP. These violate the standing harness-agnostic requirement: TMCP must not reference pod-specific concepts in any user-facing content, API responses, or runtime service messages.

Both `release/v7.11.1` and `release/v7.12.0` carry these violations. **Both PRs should be held until fixed.**

## Violations to fix

### 1. `docs/help/pod-memory.md` — help topic with pod name
- Rename to `docs/help/agent-state.md` (or operator-chosen name)
- Update all internal content to remove "pod-memory" terminology

### 2. `src/tools/help.ts` — RICH_TOPICS entry
- `"pod-memory"` → `"agent-state"` (match new filename)
- Consider backward-compat alias if needed (old callers using `help('pod-memory')`)

### 3. `docs/help/start.md` — Token Save section (NEW, added by 15-0898)
Added section:
```
## Token Save (do this first)
Write your session token to `memory/telegram/session.token` as a plain integer — no JSON, no quotes. This path survives compaction. See `help('pod-memory')` for the convention.
```
**Issues:**
- `memory/telegram/session.token` is a pod-specific file layout path → must not be hardcoded in TMCP help
- `help('pod-memory')` → pod concept

**Fix:** Either remove this section entirely (the dequeue loop section already covers token usage) OR replace with generic language: "Save your session token to a path that survives compaction. The path is harness-specific." No pod path, no pod topic.

### 4. `docs/help/quick_start.md` — "Save your token" section (NEW, added by 15-0898)
Same issue. Same fix.

### 5. `docs/help/activity/file.md` — reference to pod-memory
Line: "this path is the canonical pod-memory location for TMCP token state. See `help('pod-memory')` for the full pod-memory convention."
**Fix:** Remove or rewrite without pod terminology.

### 6. `src/service-messages.ts` — ONBOARDING_LOOP_PATTERN ⚠️ RUNTIME VIOLATION
Live service message delivered to every connecting agent contains:
> `"of your choice (e.g. your pod root or memory/ dir).\n"`

**Fix:** Replace `your pod root or memory/ dir` with `a local directory of your choice`.

### 7. `src/service-messages.ts` — ACTIVITY_LISTEN_BREADCRUMB ⚠️ RUNTIME VIOLATION
Live service message delivered on first `activity/listen` call contains:
> `` `Save to a local path (e.g. your pod root or memory/ dir), then arm:\n` ``

**Fix:** Same — replace `your pod root or memory/ dir` with `a local path of your choice`.

### 8. `docs/help/profile/notify-lockout.md` — filename/content mismatch
File is named `notify-lockout.md` but describes `profile/notify-gate`. The file cross-references `help('profile/notify-debounce')` which also has no corresponding file.
**Fix:** Rename to `notify-gate.md` and add missing `notify-debounce.md`.

### 9. `src/tools/help.test.ts` — tests referencing pod-memory
Update test names and calls to match new topic name.

### 10. `src/tools/session/start.test.ts` — save_token_to tests
Named "pod-memory convention — save_token_to field (AC9)". Update to non-pod naming.

## Acceptance criteria

1. No occurrence of "pod-memory", "pod root", or "pod-" in any user-facing content (docs, help topics, service messages)
2. `help('<new-name>')` (operator to choose) returns the same compaction-survival content
3. `help('pod-memory')` returns a deprecation notice or routes to new topic (operator to decide)
4. `docs/help/start.md` and `docs/help/quick_start.md` contain no `help('pod-memory')` cross-references
5. `src/service-messages.ts` ONBOARDING_LOOP_PATTERN and ACTIVITY_LISTEN_BREADCRUMB contain no "pod root" language
6. `docs/help/profile/notify-lockout.md` renamed to `notify-gate.md`; `notify-debounce.md` added
7. All tests pass after rename
8. Both `release/v7.11.1` and `release/v7.12.0` apply the fix

## Open question for operator

What should `pod-memory` be renamed to?
- `agent-state` — generic, describes the concept
- `compaction-state` — describes the purpose (survives compaction)
- Something else?

## Fix path

Recommend: fix on `dev` → cherry-pick back to `release/v7.11.1` (patch commit) → apply same to `release/v7.12.0`. Then PRs can proceed.


---
> ⚠️ **AUDIT 2026-06-26:** PREMISE REVERSED — the memory/telegram/session.token path was deliberately RESTORED as canonical recovery (70-done 10-3031/10-3035/10-3036). The 'remove the path' goal no longer applies; most ACs are done/moot. Reconcile to the settled policy or close.
