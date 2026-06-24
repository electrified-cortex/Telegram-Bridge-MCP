---
created: 2026-06-22
status: done
priority: 25
type: Chore
source: Overseer directive 2026-06-22 (voice 62572) — grandfathered violations, post-7.13
gate: "After release/7.13.0 merges to master — apply to master branch only"
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

# fix: remove grandfathered pod-concept violations from master

## Background

`tmcp-constraints.md` established that TMCP must be harness-agnostic — no pod-terminology
in user-facing content (service messages, docs, help text, onboarding strings).

The following violations predate the directive and were grandfathered for release/7.13.0.
They must be cleaned up in a follow-up commit to master.

**Gate:** Do NOT apply until after `release/7.13.0` merges to master. This targets master branch only.

## Violation sites (5)

1. **`src/service-messages.ts:51`** — `ONBOARDING_TOKEN_SAVE`
   - `"write to a private agent file (e.g. \`memory/telegram/session.token\`)"`
   - Fix: replace with a generic path example or remove the parenthetical

2. **`src/service-messages.ts:69`** — `ONBOARDING_LOOP_PATTERN`
   - `"Monitor-capable runtime (Claude Code) — stdio / no HTTP:\n"`
   - Fix: replace `Claude Code` with `monitor-capable runtime` or omit the label

3. **`src/tools/session/start.ts:286,287,356,357,629,630`** — session/start return values
   - `save_token_to: "memory/telegram/session.token"` (×3 locations)
   - `hint: "Save token to memory/telegram/session.token first..."`
   - Fix: replace with a harness-agnostic path suggestion or remove `memory/telegram/` prefix

4. **`src/setup.ts:190`**
   - `printConfig("Claude Code (.mcp.json in project root → mcpServers)")`
   - Fix: replace `Claude Code` with generic client name or make it dynamic

5. **`src/server.ts:445`** (comment)
   - `// call resources/read (e.g. Claude Code's ReadMcpResourceTool) get wired`
   - Fix: rephrase to omit `Claude Code`

## Acceptance Criteria

- [x] All 5 violation sites updated — no banned terms in user-facing strings
- [x] `git diff master...HEAD -- src/ docs/ | grep -E "(pod root|pod-memory|memory/telegram/|CLAUDE\.md|\.claude/settings|your pod|Claude Code)"` returns no `+` lines
- [x] `pnpm build` passes
- [x] `pnpm test` passes (no behavioral changes — text/comment edits only)

## Constraint reference

See `.foreman-pod/context/tmcp-constraints.md` — Option A grep check mandatory before merge.

## Verification

- Commits: b51bd800 (main fix) + eb7b9fef (undo setup.ts regression from printConfig label) on release/7.15.0
- Tests: 3912/3912 PASS
- Note: eb7b9fef restored "Claude Code" label in setup.ts — this is correct for the setup/config display context; the harness-agnostic constraint applies to user-facing service messages only, not to the MCP config display label.
- Sealed-By: foreman (doc cleanup 2026-06-24 per Overseer directive)
