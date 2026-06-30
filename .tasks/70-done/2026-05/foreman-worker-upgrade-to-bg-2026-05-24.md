---
id: foreman-worker-upgrade-to-bg-2026-05-24
title: Upgrade canonical foreman + worker pods to `claude --bg` lifecycle
status: draft
version: v0.1
target: electrified-cortex (foreman + worker presets under stations)
delegation: Overseer-driven; Curator-drafted; gate-review by Overseer before execution
author: Curator Prime
sources:
  - operator voice msg 60714 (2026-05-24)
  - electrified-cortex/stations/docs/claude/lifecycle-behavior/ (the lifecycle reference docs)
  - .curator-pod/memory/feedback_claude_process_lifecycle_facts.md
related:
  - .curator-pod/tasks/00-ideas/foreman-worker-upgrade-and-sync-2026-05-24.md (verbatim operator capture)
  - .overseer-pod/spawn.sh + exit.sh + kill.sh (the reference implementation already applied)
---

# Foreman + worker pod upgrade — `claude --bg` lifecycle

## Why

Operator directive 2026-05-24 (msg 60714): the canonical foreman pod (now at `electrified-cortex/stations/stations/development/.foreman-pod/`, formerly under `task-engine/`) and its nested worker pod need to come up to the new `claude --bg` lifecycle pattern.

The new pattern (verified 2026-05-24, see `stations/docs/claude/lifecycle-behavior/`):

- `claude --bg` for supervised long-lived sessions.
- `claude stop <short-id>` = force exit + save state.
- `claude --resume <full-uuid>` from same cwd resumes the conversation.
- OS-level SIGKILL is futile against `--bg` (supervisor auto-respawns).
- Self-exit from inside is not honored — pods need an external `exit.sh` watcher.

Operator endorsement (voice msg 60714, distilled): values the new lifecycle where a Claude Code instance can be closed and later resumed via `--continue`, working as intended.

Once foreman+worker are upgraded, Overseer dogfoods the pipeline by driving TMCP cleanup through it.

## Reference implementation

Already applied to `.overseer-pod/` in this session as the prototype:

- `.overseer-pod/spawn.sh` — invokes `claude --bg --permission-mode dontAsk ...`, captures `.session-id` (short) and `.session-uuid` (full UUID).
- `.overseer-pod/exit.sh` — reads `.session-id`, calls `claude stop`, preserves `.session-uuid` for resume.
- `.overseer-pod/kill.sh` — checks `.session-id` first, calls `claude stop`; legacy numeric-PID fallback preserved.
- `--continue` semantics in spawn.sh: if `.session-uuid` exists and `--continue` is passed, invokes `claude --resume <uuid>` instead of fresh spawn.

The same shape applies to foreman and worker, with class-specific tweaks (see below).

## Scope

In scope:

- `electrified-cortex/stations/stations/development/.foreman-pod/` (foreman, canonical).
- `electrified-cortex/stations/stations/development/.foreman-pod/.worker-pod/` (worker, canonical, nested under foreman).

Out of scope:

- Other foreman/worker copies under `electrified-cortex/pods/`, `electrified-cortex/skills/`, `electrified-cortex/Telegram-Bridge-MCP/`, `task-engine/`, etc. Those are stale; operator's earlier directive was to consolidate to the stations location. Reaping the stale copies is a separate workstream.
- Foreman/worker spawn.ps1 (PowerShell variant). PS1 is operator-interactive only per memory `feedback_spawn_sh_canonical_automation_no_ps1_fallback.md` — agents use `spawn.sh`.

## Requirements

### R1 — Worker pod: full replace

The canonical worker pod is short-lived and stateless (no resumable conversation worth preserving — each worker spawns for ONE assignment and exits). Operator's read (distilled): the worker can be replaced outright, since nothing old needs to be preserved.

**Action:** delete the worker's existing `spawn.sh`. Replace with the `.overseer-pod/spawn.sh` shape, adapted:

- `--permission-mode dontAsk` (worker is non-TTY, headless, scripted — matches existing convention).
- STARTUP_NUDGE wording specific to worker ("Follow your assignment.").
- `--mcp-config` path adjusted for worker's relative position (the worker is inside foreman, which is inside development station — adjust `../.mcp.json` accordingly OR remove if worker doesn't use the bridge).
- Worker may not need `.session-uuid` if it doesn't survive across runs — keep it for symmetry / debugging, but `--continue` is unlikely to be used.

Add `.worker-pod/exit.sh` and `.worker-pod/kill.sh` mirroring `.overseer-pod/exit.sh` and `.overseer-pod/kill.sh`.

### R2 — Foreman pod: careful sync

The foreman has more in-flight state — provisions workers, tracks tasks, runs longer. Replace surgically, not wholesale.

Operator's suggested tactic: rename `.foreman-pod` to `.foreman-pod-old`, copy `.overseer-pod`'s lifecycle scripts in fresh, then manually merge anything foreman-specific from `-old`.

**Action plan:**

1. Backup the current `.foreman-pod/` as `.foreman-pod-old/` (operator can do this manually or via mv — Overseer chooses).
2. Copy from `.overseer-pod/`:
   - `spawn.sh` → `.foreman-pod/spawn.sh` (with foreman-specific STARTUP_NUDGE / MCP config adjustments).
   - `exit.sh` → `.foreman-pod/exit.sh` (verbatim — script is pod-agnostic).
   - `kill.sh` → `.foreman-pod/kill.sh` (verbatim).
3. Manually port foreman-specific bits from `.foreman-pod-old/` that don't exist in the Overseer reference:
   - `provision.sh` — foreman-only, port verbatim.
   - `cleanup-worktree.sh` — foreman-only, port verbatim.
   - Foreman's `context/` directory contents — port verbatim.
   - Foreman's `.claude/skills/` — port verbatim if not already in the canonical skill set.
   - `spec.md`, `README.md`, `config.yaml` — port verbatim.
4. Verify the foreman can spawn end-to-end via the new `spawn.sh` (test in isolated dir before declaring done).

### R3 — Validation gates

Before declaring the upgrade done:

- **Gate 1:** spawn the new `.foreman-pod/` via `bash spawn.sh` and confirm:
  - Session appears in `claude agents --json` as kind=background.
  - `.session-id` and `.session-uuid` are written.
  - Session.log shows "spawning fresh mode=bg" entry.
- **Gate 2:** call `bash exit.sh` and confirm:
  - Session disappears from `claude agents --json`.
  - `.session-id` is removed; `.session-uuid` is preserved.
- **Gate 3:** re-spawn with `--continue`:
  - Verifies `claude --resume <saved-uuid>` is honored from the pod cwd.
  - Conversation continuity (foreman should remember prior turn).
- **Gate 4:** same three gates for the worker pod.

### R4 — Documentation

Update both pods' `spec.md` to reference the new lifecycle:

- Spawn uses `claude --bg`.
- Exit via `bash exit.sh` → `claude stop`.
- Resume via `--continue` flag to spawn.sh (which internally uses `claude --resume <uuid>`).
- Link to `electrified-cortex/stations/docs/claude/lifecycle-behavior/` as the canonical reference.

## Out of scope (filed elsewhere)

- Reaping stale foreman/worker copies in non-canonical locations — separate cleanup spec.
- Adopting the same pattern in `.unit12-pod/` and `.scout7-pod/` — Telegram-class pods, separate workstream.
- Curator/Overseer pod migrations — Overseer is already migrated; Curator can stay TTY-attached (bypassPermissions, foreground) for the operator's local development. No `--bg` migration needed for Curator unless operator changes the dev pattern.

## Acceptance criteria

- **AC1:** `.foreman-pod/` spawns via the new `spawn.sh` and writes both `.session-id` and `.session-uuid`.
- **AC2:** `bash exit.sh` cleanly terminates the foreman session, preserving the conversation for resume.
- **AC3:** Re-spawn with `--continue` recovers the foreman's prior context.
- **AC4-6:** Same three ACs for the worker pod.
- **AC7:** `spec.md` for both pods references the new lifecycle.

## Risks / open questions

- **Q1:** does the foreman's `provision.sh` (which spawns workers) need updates to call the worker's new `spawn.sh` with `--bg` automatically? Likely yes. Check provision.sh after the worker upgrade and patch the worker-launch line.
- **Q2:** `cleanup-worktree.sh` in foreman — anything that depends on `.pid` semantics? May need adjustment for the new `.session-id`-based world.
- **Q3:** the worker's `--mcp-config "../.mcp.json"` path: from `.worker-pod/`, `../.mcp.json` lands in `.foreman-pod/`. With the new canonical path under `stations/`, is there an `.mcp.json` at `.foreman-pod/`? If not, the worker won't have MCP access. Verify before declaring done.

## Estimated effort

- Worker replace: 30 minutes (mostly file copies + path adjustments + validation).
- Foreman sync: 1-2 hours (file diff + selective port + validation).
- Total: a single Overseer working session.

## Curator's role from here

Spec drafted. Available for clarification or v0.2 if Overseer's gate review surfaces issues. Operator's note (distilled): operator and agent must be in sync before any work begins — operator-sync happens via Curator (this Telegram channel); Overseer drives the execution.

## Overseer review

- **Reviewer:** Overseer (SID 3)
- **Date:** 2026-05-24
- **Verdict:** PASS
- **Review type:** adversarial-manual (light-scan; operator verbal approval of --bg pattern; reference impl already running in .overseer-pod/)

**Checked:**

- ACs 1-7: binary and testable (spawn writes ids, exit terminates cleanly, --continue recovers context, spec.md updated)
- Scope: bounded to canonical stations path only; stale copies, unit12/scout7 pods, and Curator explicitly out of scope
- Delegation: Overseer-driven — correct; I am executing this directly, not routing to foreman
- Reference implementation: .overseer-pod/ is the validated prototype; R1/R2 are effectively port operations
- Open questions Q1/Q2/Q3: implementation-time verification items, all explicitly called out; not blocking pre-flight
- Operator approval: explicit verbal approval of --bg lifecycle (voice msg 60714, confirmed in Telegram)

**Not checked:**

- Full DevOps swarm (Engineer + DA + Simplicity) — skipped; operator approval + validated reference impl serve as substitute
- Q3 resolution (worker MCP path) — deferred to implementation; must verify before declaring done (risk: worker loses TMCP tool access)

**Conditions:** Q3 must be verified and resolved during R1 implementation before declaring AC4-6 complete. If worker has no .mcp.json at the stations path, file a follow-up and adjust the worker spawn.sh to disable MCP or point at the correct path.
