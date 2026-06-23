---
id: 10-0012
title: Monitor script hardening — CRITICAL + MAJOR findings from adversarial review
priority: P2
status: done
created: 2026-06-23
source: Overseer adversarial review (agent a846399ee2d6dcb9f) — post v7.13.0 merge
---

# Monitor script hardening

Adversarial review of all listen/monitor scripts surfaced issues filed here for the next sprint.
Review was requested by operator (TG 78407) and ran against the v7.13.0 codebase.

---

## CRITICAL — worker-pod/outbox/monitor.sh: exit inside pipe subshell

**File:** `.foreman-pod/.worker-pod/outbox/monitor.sh`

`exit 0` inside the `while IFS= read -r line; do ... done` body exits the **subshell** (right-hand side of the pipe), NOT the parent script. `watch.sh` on the left-hand side keeps running until it receives SIGPIPE on its next write — up to 2 seconds later. The script does eventually exit, but the delay is non-deterministic and could cause a duplicate event before SIGPIPE propagates.

**Fix options:**
- `shopt -s lastpipe` (bash 4.2+) — makes the `while` body run in the main shell, so `exit` works as expected.
- Restructure to avoid the pipe entirely (use process substitution or a temp file).

**AC:**
- [ ] `exit` inside the `while` loop body terminates the script promptly (no SIGPIPE delay).
- [ ] Test: send a `timeout` token to watch.sh stub → script exits within 200ms.

---

## MAJOR — tools/monitor.ps1: FileSystemWatcher recreated per iteration

**File:** `tools/monitor.ps1`

A new `FileSystemWatcher` is created, used for `WaitForChanged`, then `Disposed` on every loop iteration. There is a TOCTOU window between `Dispose()` and the new watcher construction where `LastWrite` events are silently missed.

Additionally: no `try/catch` around `WaitForChanged` — if the file is deleted mid-wait, a `FileNotFoundException` or early `TimedOut` fires uncaught, terminating the script without emitting a `timeout` or `closed` token.

**Fix:**
- Hoist `FileSystemWatcher` creation before the loop; `Dispose()` only on final exit.
- Wrap `WaitForChanged` in `try/catch`; on exception fall through to the `else` (sleep) branch.

**AC:**
- [ ] `FileSystemWatcher` created once before loop, disposed after.
- [ ] `WaitForChanged` call is wrapped in try/catch; exception falls through to poll sleep.
- [ ] Test: delete the watched file mid-wait → script emits `closed` and exits cleanly.

---

## MAJOR — tools/monitor.sh: no SIGTERM/SIGINT trap

**File:** `tools/monitor.sh`

No `trap` for SIGTERM or SIGINT. On hard kill, the `sleep 2` child may briefly orphan. Also: no pre-flight check that the activity file's parent directory exists — if it doesn't, the monitor loops silently forever.

**Fix:**
```bash
trap 'exit 0' INT TERM
```
Add near top. Also add a pre-flight: if the parent directory of `$ACTIVITY_FILE` doesn't exist, emit an error and exit 1.

**AC:**
- [ ] `trap 'exit 0' INT TERM` present near script top.
- [ ] Pre-flight: `ACTIVITY_FILE` parent dir missing → error message to stderr + exit 1.

---

## MINOR — tools/sse-monitor.sh: bash version floor + mktemp -u + connect-timeout

**File:** `tools/sse-monitor.sh`

Three minor issues:
1. Script states `bash >= 4.2` required but uses `EPOCHSECONDS` (bash 5.0+). Windows Git Bash ships 4.4 by default — script will fail with a misleading "bash too old" message on these systems.
2. `mktemp -u` (TOCTOU race) — use `mktemp -d` + `mkfifo` inside to eliminate the window.
3. No `--connect-timeout` on curl — a stalled TCP handshake burns the full 75s silence budget per retry.

**Fix:**
1. Raise version check to `>= 5.0` (or replace `EPOCHSECONDS` with `$(date +%s)` for 4.2 compat).
2. `fifo_dir=$(mktemp -d) && fifo="$fifo_dir/fifo" && mkfifo "$fifo"` — clean up `fifo_dir` on EXIT.
3. Add `--connect-timeout 10` to the curl invocation.

**AC:**
- [ ] Version check floor matches actual `EPOCHSECONDS` requirement (5.0 or replaced with `date +%s`).
- [ ] FIFO created via `mktemp -d` — no `-u` flag.
- [ ] curl invocation includes `--connect-timeout 10`.

---

## Acceptance Criteria (overall)

- [ ] All four issues above addressed with matching tests where applicable.
- [ ] `pnpm build && pnpm test` pass (no regressions).
- [ ] TMCP harness-agnostic rule: no pod-terminology in any changed user-facing content.

## Verification

- **Verdict:** APPROVED (Overseer waiver 2026-06-23)
- **Verifier:** agent a78141e929bcce0d7 (second pass)
- **Confirmed (9/11):** CRITICAL-AC1 (shopt+s lastpipe present), MAJOR-ps1-AC1 (FSW hoisted), MAJOR-ps1-AC2 (WaitForChanged try/catch), MAJOR-sh-AC1 (trap INT TERM), MAJOR-sh-AC2 (parent-dir preflight), MINOR-AC1 (bash 5.0 floor), MINOR-AC2 (mktemp -d FIFO), MINOR-AC3 (--connect-timeout 10), Overall-AC3 (no pod-terminology)
- **Waived:** CRITICAL-AC2 (200ms timing test), MAJOR-ps1-AC3 (file-delete mid-wait test) — shell behavioral tests outside vitest scope; deferred to task 10-0016
- **Build/Test:** build=0, test=3877/3877
- **Squash commit:** c3203c6 onto release/7.14.0
- **PR:** #232 (fix/monitor-script-hardening → release/7.14.0)
- **Sealed-By:** foreman 2026-06-23
