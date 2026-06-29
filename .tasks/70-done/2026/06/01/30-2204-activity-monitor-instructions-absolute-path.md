---
Created: 2026-05-23
Status: backlog
Priority: medium
Source: operator voice 2026-05-23 ~08:50 PT; Curator boot failure
---

# `activity_file_monitor_instructions` should use absolute path for monitor scripts

## Problem

The `activity_file_monitor_instructions` service message ships relative paths:
- Windows: `tools/monitor.ps1 "<activity_file>"`
- Linux/macOS: `tools/monitor.sh "<activity_file>"`

All pods run with CWD set to their own pod root, not the TMCP repo. Relative path resolution fails with exit 127 on first Monitor arm. Curator hit this at boot 2026-05-23; Unit-12 only works because a prior sync vendored `tools/monitor.sh` into the Unit-12 pod root.

## Acceptance Criteria

- [ ] `activity_file_monitor_instructions` payload `text` field uses absolute path to `tools/monitor.{ps1,sh}` (resolved via `__dirname` or equivalent at runtime).
- [ ] `details.script_path` field added with Windows and POSIX variants so agents can consume the path structurally rather than parsing prose.
- [ ] Sweep for any other service message that assumes CWD (e.g. `setup-hooks.sh`, `spawn.*` hints) and fix those too.
- [ ] Verified on a fresh Curator boot: first `Monitor` arm call with the supplied command succeeds without exit 127.
- [ ] Curator memory `feedback_tmcp_monitor_relative_path.md` can be retired after ship + verification.

## Acceptance Criteria

- [x] `activity_file_monitor_instructions` payload `text` field uses absolute path to `tools/monitor.{ps1,sh}` (resolved via `__dirname` or equivalent at runtime).
- [x] `details.script_path` field added with Windows and POSIX variants so agents can consume the path structurally rather than parsing prose.
- [x] Sweep for any other service message that assumes CWD (e.g. `setup-hooks.sh`, `spawn.*` hints) and fix those too.
- [ ] Verified on a fresh Curator boot: first `Monitor` arm call with the supplied command succeeds without exit 127. *(post-merge Curator verification)*
- [ ] Curator memory `feedback_tmcp_monitor_relative_path.md` can be retired after ship + verification. *(post-merge Curator action)*

## Overseer review

- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS
- review type: adversarial dispatch
- checked: bug confirmed real (service-messages.ts lines 189-190 hardcode relative paths), ACs binary/testable, scope bounded, delegation Worker
- constraints: sandboxed worktree only, no push/merge; Curator reviews diff before any merge

## Verification

- **Verdict:** APPROVED (curator ruling — AC4/AC5 deferred post-merge)
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `013c166` on `dev`
- **Worker commit:** `f24cd7f8` on `worker/30-2204-activity-monitor-instructions-absolute-path`
- **Test evidence:** 3271/3271 tests pass (142 files), tsc clean
- **AC1-AC3:** CONFIRMED. AC4/AC5 post-merge Curator verification steps per Overseer ruling.
