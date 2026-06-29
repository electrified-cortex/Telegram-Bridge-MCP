---
created: 2026-06-01
status: 10-drafts
priority: 10-2002
source: operator-call-2026-06-01 (Curator #1 super-agent score-lever)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
target_branch: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-2002 — Structural presence: mount /hook/animation so a PreToolUse hook can auto-fire "working"

## Context

Durable agents (Curator, Unit-12) repeatedly "go dark" during multi-tool bursts — a recurring Law-5 presence failure that caps Invisibility, Presence, and Compounding on the super-agent rubric. A memory rule has failed 3+ times; the fix must be STRUCTURAL (fires automatically, can't be skipped), not another reminder.

The clean structural fix is a PreToolUse hook firing a `working` animation on every tool call. The infrastructure ALREADY EXISTS but is not wired:

- PreToolUse hook chain exists: `.claude/settings.json` PreToolUse → `event.sh tool` → `event.local.sh`.
- TMCP exposes `POST /hook/animation` (`src/hook-animation.ts`), built for exactly this.
- BUT `src/index.ts` (HTTP mode, ~line 146-147) calls `attachEventRoute(app)` + `attachDequeueRoute(app)` and NEVER calls `attachHookRoutes(app)`. Verified 2026-06-01: `/hook/animation` returns Express 404 HTML; `/event` + a valid token works (route mounted, token valid).

## Objective

Make presence structural fleet-wide by enabling the hook→animation path:

1. **TMCP:** mount `attachHookRoutes(app)` in `src/index.ts` (HTTP mode block).
2. **Pod-side:** in `.claude/hooks/event.local.sh`, when the event KIND is `tool`, POST `{preset:"working", timeout:60, token}` to `/hook/animation` (scoped to animation channel — presence, not noise).
3. **Token freshness:** ensure the pod's `memory/telegram/session.token` is refreshed with the live token at session start (it was found stale — a prior session's token rather than the live one — silently breaking the hook + lifecycle forwarding).

## Acceptance Criteria

1. After deploy, `POST /hook/animation` with a valid token returns `{ok:true}` JSON (not 404 HTML); fires an animation in the session.
2. A PreToolUse tool event causes a `working` animation to appear, with zero agent action required.
3. DEBOUNCED — fire at most ONE animation per work-burst. The hook/endpoint MUST NOT re-fire while an animation is already active for the session (check `hasActiveAnimation` server-side, or a per-session cooldown). Presence shows once at burst start and self-clears on its timeout. Firing on EVERY tool call is explicitly WRONG: it floods the bridge and TANKS Invisibility (the dimension this is meant to raise). The first tool after silence fires it; subsequent calls within the window are no-ops.
4. The pod token file holds the current session token after startup (no staleness).
5. Deploy touches the LOCAL bridge only — does NOT bounce Unit-12's separate container bridge.
6. `tsc --noEmit` passes; `npm run build` succeeds.

## Proposed approach (reference — Curator diagnosed + drafted; Worker verifies, owns, deploys)

- `src/index.ts`: `import { attachHookRoutes } from "./hook-animation.js";` + `attachHookRoutes(app);` after `attachDequeueRoute(app);`.
- `event.local.sh`: add a `KIND="tool"` branch that curls `${BRIDGE}/hook/animation?token=${TOKEN}` with `{preset:working,timeout:60,token}` (reuse the existing token-read + `-m 3` curl scaffold; keep silent + exit 0).
- Token refresh: at session start (telegram-participation / startup), write the live session token to `memory/telegram/session.token`.

## Out of Scope

- Changing animation presets or adding new ones.
- Per-tool filtering (fire on all tools for v1; timeout self-clears). Worker may add a Bash/Agent/Edit filter if noise is observed.

## Delegation

Executor: Worker
Reviewer: Curator

## Affected Files / Repos

- `electrified-cortex/Telegram-Bridge-MCP/src/index.ts` (mount route)
- pod `.claude/hooks/event.local.sh` (tool→animation branch)
- pod startup/token-write path (token freshness)

## Blockers

None. (Deploy = build + restart local bridge.)

## Rollback

Not a governance path beyond the pod hook. Rollback = revert `index.ts` + the `event.local.sh` branch. Bridge restart is local-only.

## Notes

- This is Curator's #1 super-agent score-lever — it uncaps Invisibility/Presence (currently capping the score at ~2.6/5). It also benefits Unit-12 and every pod: fleet-wide structural presence.
- Curator diagnosed this end-to-end but, per role, does not self-build/deploy bridge code — Worker implements, verifies, and does the careful local-only deploy.

## Overseer review
- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS (conditional)
- review type: adversarial dispatch
- checked: target files confirmed (src/index.ts, src/hook-animation.ts), gap confirmed real (attachHookRoutes missing from index.ts), ACs mostly binary
- note: AC3 debounce verification underspecified (hasActiveAnimation vs per-session cooldown — worker should choose and document). Pod-side file path not pinned — worker to locate event.local.sh and token-write path locally.

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `1e96250` on `dev`
- **Worker commit:** `f672052c` on `worker/10-2002-structural-presence-hook`
- **Test evidence:** 3275/3275 tests pass (142 files), tsc clean, build clean
- **AC3 debounce:** Option A (server-side) — `hasActiveAnimation(sid)` in `hook-animation.ts` returns early if animation active, making endpoint idempotent
- **Token freshness:** `event.sh` writes `TELEGRAM_SESSION_TOKEN` to `memory/telegram/session.token` on `started` event
- **Pod-side files:** `event.local.sh` and `event.sh` on disk in `.worker-pod/.claude/hooks/` (pod infrastructure, not in git)
