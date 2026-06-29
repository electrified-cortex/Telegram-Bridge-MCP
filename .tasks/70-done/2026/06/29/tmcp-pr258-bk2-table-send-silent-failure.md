# Task: TMCP PR #258 — BK-2: Table Send Fail-Loud Guard

**Branch:** dev (HEAD: cc7492da)
**Delegation:** electrified-cortex/Telegram-Bridge-MCP foreman
**File:** `src/tools/send.ts` (primary change area ~line 681)
**Scope update:** 2026-06-29 — full rendering fix BACKLOGGED (operator: low priority). This task = minimal fail-loud guard only.

## Background

PR #258 removed TABLE_WARNING without a replacement guard. Any send path that hits a table but cannot render it (multi-chunk, effect, audio-queued) currently returns false success. That false success is the gate blocker.

**Operator ruling (2026-06-29):** Rich-text/HTML renders tables only up to Telegram's 4096-char/message limit; an oversized table cannot be one message in any mode. Full table rendering (Case A/B) is backlogged as low priority. PR #258 unblocks with the cheap fail-loud guard alone.

## What This Task Does

Restore a TABLE_WARNING-style signal: any send path that would have delivered a table silently without rendering it must instead return an explicit error/warning to the caller. The content must never be silently dropped.

This covers all paths: multi-chunk content with a table, effect sends with a table, audio-queued sends with a table.

## Solution

Before any send path that bypasses the GFM rich path, detect whether the content contains a Markdown table. If a table is detected and the rich path will not be used:
- Return an explicit `TABLE_NOT_RENDERED` error (or equivalent warning) to the caller
- Do NOT silently send without the table rendered

Detection heuristic: content contains a line matching `|---|` or `| --- |` pattern (GFM table separator row).

No rendering attempt required — the guard prevents silent failure; the caller can decide how to proceed.

## Scope

- `src/tools/send.ts` — add table-detection guard on all non-rich-path branches
- `src/tools/send.test.ts` (or equivalent) — tests for effect+table → error, audio-queued+table → error, multi-chunk+table → error
- No changes to audio-remap, profile, schema, or cascade logic

## Acceptance Criteria

- [ ] `send` with table content and `effect` set: returns `TABLE_NOT_RENDERED` error (not false success)
- [ ] `send` with table content and in-flight audio: returns `TABLE_NOT_RENDERED` error (not false success)
- [ ] `send` with table content spanning multiple chunks: returns `TABLE_NOT_RENDERED` error (not false success)
- [ ] `send` with table content on the GFM rich path (single-chunk, no effect, no inflight audio): succeeds and renders normally — guard must NOT block this path
- [ ] No code path returns `ok: true` to the caller when a table was present but not rendered
- [ ] `pnpm test` passes (all 4230+ tests green)
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Version bump to v7.22.9 (or next after BK-1/BK-3/W-6 lands) in package.json + CHANGELOG entry
- [ ] Commit to `dev` branch with conventional commit message

<!-- overseer-gate: PASS 2026-06-29 (scope narrowed by operator/Curator — guard only, rendering backlogged) -->

## Out of Scope

- Case A fix (effect/audio-queued → rich path): BACKLOGGED (see tmcp-backlog-table-rendering.md)
- Case B fix (multi-chunk table isolation): BACKLOGGED
- Audio-remap changes (separate task)
- W-1 through W-7 warnings (separate concern)

## Verification

**Verdict:** APPROVED
**Verifier:** a7a439646bc54131a
**Date:** 2026-06-29
**Squash commit:** 0850bca1 (version corrected to 7.22.9 by foreman at merge)
**Evidence:** 4233 tests pass (173 files), lint exit 0, build exit 0
**All 10 AC confirmed.** TABLE_NOT_RENDERED guard on effect/audio/multi-chunk paths; GFM rich path unaffected.
Sealed-By: foreman/036d928b
