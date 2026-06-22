---
created: 2026-06-22
status: draft
priority: P2
source: Overseer directive 2026-06-22 (voice 62572) — grandfathered violations, post-7.13
---

# fix: remove grandfathered pod-concept violations from master

## Background

`tmcp-constraints.md` established that TMCP must be harness-agnostic — no pod-terminology
in user-facing content (service messages, docs, help text, onboarding strings).

The following violations predate the directive and were grandfathered for release/7.13.0.
They must be cleaned up in a follow-up commit to master.

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

- [ ] All 5 violation sites updated — no banned terms in user-facing strings
- [ ] `git diff master...HEAD -- src/ docs/ | grep -E "(pod root|pod-memory|memory/telegram/|CLAUDE\.md|\.claude/settings|your pod|Claude Code)"` returns no `+` lines
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (no behavioral changes — text/comment edits only)

## Constraint reference

See `.foreman-pod/context/tmcp-constraints.md` — Option A grep check mandatory before merge.
