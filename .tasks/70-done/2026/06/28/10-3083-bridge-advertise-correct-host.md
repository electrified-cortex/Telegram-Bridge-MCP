---
id: 10-3083
title: "TMCP: Bridge advertises 0.0.0.0 in activity/listen; agents must rewrite host manually"
priority: P2
status: draft
category: Bug/DX
filed: 2026-06-28
source: TG 81212
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-advertise-host
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3083: Bridge Advertises Incorrect Host in activity/listen

## Problem

`activity/listen` returns an SSE command URL with host `0.0.0.0`. Agents must rewrite
this host before arming their SSE monitor:
- Container deployments: rewrite to `bridge` (container hostname)
- Host-machine deployments: rewrite to `127.0.0.1`

This rewrite is a footgun — easy to miss, and the failure mode is silent (the monitor
arms without error but never fires). The telegram-participation skill documents a workaround
in rule R5, but the fix should live at the source.

## Fix

Advertise the correct host in the `activity/listen` response so no client-side rewrite is
needed.

**Approach**: add an env var `BRIDGE_ADVERTISE_HOST` (optional). When set, `activity/listen`
substitutes this value as the host in the returned SSE URL. When unset, current behavior
(0.0.0.0) is preserved for backward compat.

Typical values:
- Container deployment: `BRIDGE_ADVERTISE_HOST=bridge`
- Host-machine deployment: `BRIDGE_ADVERTISE_HOST=127.0.0.1`
- Auto-detect (stretch): if `BRIDGE_ADVERTISE_HOST` is unset, attempt to derive the
  correct host from `HOSTNAME` env var or Docker networking — document if attempted.

## Acceptance Criteria

- [ ] When `BRIDGE_ADVERTISE_HOST=myhost` is set, `activity/listen` returns an SSE URL
      with host `myhost` instead of `0.0.0.0`
- [ ] When `BRIDGE_ADVERTISE_HOST` is absent or empty, existing behavior is unchanged
      (backward compat)
- [ ] `config.example.toml` or relevant config documentation updated with
      `BRIDGE_ADVERTISE_HOST` description and typical values
- [ ] The telegram-participation skill's R5 workaround note updated or removed
      (if the worker has write access to the skill file; otherwise file a follow-on note)
- [ ] `npm run build` passes; existing tests pass
- [ ] Worker smoke test: set `BRIDGE_ADVERTISE_HOST=127.0.0.1`; call `activity/listen`;
      confirm returned URL uses `127.0.0.1` as host

## Worker notes

- Find where the SSE URL is constructed in the `activity/listen` handler
  (`src/tools/activity/listen.ts` or similar)
- The URL construction likely uses `process.env.BRIDGE_HOST` or a hardcoded value —
  add the `BRIDGE_ADVERTISE_HOST` env check here
- Update `Dockerfile` or `.env.example` with the new variable if either exists in the repo

## Worktree

Branch: `worker/tmcp-p4-advertise-host`
Directory: `.git/.wt/tmcp-p4-advertise-host`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 binary+testable; backward compat explicitly addressed (absent env var → unchanged behavior); scope bounded to 1 env var + URL construction; doc update and skill workaround note acknowledged; delegation correct (Worker, sonnet-class, medium)
- fixed: corrected body heading 10-3080→10-3083; base branch main→dev
<!-- overseer-gate: PASS 2026-06-28 -->

## Verification

- **verdict**: APPROVED
- **verifier**: Overseer (push-gate, bundled with 10-3082)
- **date**: 2026-06-28
- **worker_commit**: 784af1b2 (+ foreman IPv6 fix eb869881)
- **squash_commit**: TBD
- **tests**: 4185/4185 (171 test files — branch HEAD eb869881)
- **ACs**: 1 PASS (BRIDGE_ADVERTISE_HOST substitutes host in SSE URL); 2 PASS (unset/empty preserves existing behavior); 3 PASS (.env.example documented); 4 PASS (telegram-participation SKILL.md R5 updated); 5 PASS (build clean, tests pass); smoke test validation-only
- **notes**: foreman hardened regex to handle IPv6 literal hosts [::1] — original pattern [^/:] would corrupt IPv6 URLs
- **LLM pre-pass**: gateway timed out — independent adversarial review substituted
