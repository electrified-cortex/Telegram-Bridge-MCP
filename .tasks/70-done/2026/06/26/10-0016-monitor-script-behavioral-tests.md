---
id: 10-0016
title: Add behavioral test harness for monitor scripts — timing and file-deletion ACs
priority: P3
status: queued
created: 2026-06-23
source: Overseer waiver on 10-0012 AC2 + AC3 (vitest cannot cover shell/ps1 behavior)
---

# Monitor script behavioral test harness

## Background

10-0012 was approved with a waiver on two ACs that require a shell/ps1 test harness:
- CRITICAL-AC2: outbox/monitor.sh exits within 200ms after `timeout` token (validates `shopt -s lastpipe` fix)
- MAJOR-ps1-AC3: monitor.ps1 emits `closed` and exits cleanly when watched file is deleted mid-wait

These behavioral tests cannot be run by vitest and were deferred to this task.

## Scope

Write a lightweight test harness (bash script and/or pwsh) that validates:

1. **outbox/monitor.sh 200ms exit** — stub watch.sh to emit a `timeout` token, measure time from emission to monitor.sh exit. Must be < 200ms.
2. **monitor.ps1 file-deletion** — start monitor.ps1 watching a temp file, delete the file while WaitForChanged is blocking, assert script does NOT crash (no unhandled exception), loops through to next iteration.

Place tests in `tools/test/` or a similar location. Tests must be runnable standalone and not require any external services.

## Acceptance Criteria

- [ ] bash test for 200ms exit timing on `timeout` token (CRITICAL-AC2)
- [ ] pwsh test for file-deletion mid-wait graceful handling (MAJOR-ps1-AC3)
- [ ] Both tests pass in CI on Windows (Git Bash + pwsh available)
- [ ] pnpm test passes with no regressions

---

## Overseer review

- **Reviewer:** Overseer (SID 2)
- **Date:** 2026-06-25
- **Verdict:** PASS — cleared for foreman
- **Review type:** Adversarial spec gate (close read)
- **Checked:** 4 ACs binary + testable (200ms timing on `timeout` token, monitor.ps1 file-deletion graceful handling, CI-on-Windows pass, no pnpm regressions); scope bounded (S — test harness only, no external services); no open questions; validates the two ACs waived from 10-0012.
- **Not checked:** implementation correctness — covered by the post-implementation PR gate.
- **Note:** Pure test-harness task; no overlap with the nudge tasks — safe to interleave but the single-worker plan runs it sequentially anyway.
- **Delegation:** worker implements → foreman verifies ACs (per operator directive 2026-06-25).

---

## Verification

- **Verifier:** Foreman (adversarial review — Overseer gate)
- **Date:** 2026-06-26
- **Verdict:** APPROVED
- **Overseer review:** PASS (2026-06-26) — gate-bounce fix (CI portability) also reviewed and passed
- **Tests:** 3926/3926 pass, lint clean
- **Commits:** `9aff8f5f` (test harness), `840b335e` (vendor fixture — CI portability fixup)
- **Squash on dev:** `2c34349`
- **Notes:** bash test FIFO timing ≤200ms (delta 8ms observed); pwsh test file-deletion grace; fixture vendored to tools/test/fixtures/outbox-monitor.sh for CI-clean path.
