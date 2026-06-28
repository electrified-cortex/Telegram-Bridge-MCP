---
title: "TMCP: Prevent HTML entity encoding in agent text messages"
id: 10-3075
priority: P3
status: draft
category: Bug / Documentation
filed: 2026-06-28
source: TG 81059
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-html-encoding-fix
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

## Refinement needed

- date: 2026-06-28
- verdict: NEEDS REFINEMENT (original bounce)
- findings resolved in this version:
  1. ✅ Added delegation frontmatter (`repo`, `branch_target`, `agent_type`, `model_class`, `source`)
  2. ✅ AC1 rewritten as binary — investigation moved to spec body below; AC is now a deliverable
  3. ✅ AC3 removed — Option B made a separate follow-on task (not in this spec)
  4. ✅ AC4 reframed as worker smoke-test checklist note, not a gate-able AC

# HTML Entity Encoding in Agent Text Messages

## Problem

Agents intermittently send HTML-encoded characters in `type: "text"` messages — e.g., `&lt;T&gt;` instead of `<T>`. Because `type: "text"` uses MarkdownV2 parse mode (not HTML), the HTML entities are not decoded and appear literally to the reader.

Confirmed seen from multiple agents across sessions — not isolated.

## Root Cause

LLMs default to HTML-safe output when generating text containing `<`/`>` (e.g., generic type syntax `List<T>`). No existing skill or system prompt explicitly instructs agents otherwise.

## Investigation Results (pre-spec)

No skill or system prompt actively encourages HTML encoding — the behavior is a model training habit. The fix is entirely in documentation and prompting.

## Fix (Option A only — this spec)

Add explicit instruction to TMCP agent-facing docs (help guide, communications guide, and/or worker skill template):

> Do NOT HTML-encode characters in message text. Write `List<T>` not `List&lt;T&gt;`. The bridge applies MarkdownV2 formatting — HTML entities are passed through literally and will appear broken. Inside backtick code spans, angle brackets are safe without any escaping.

Option B (defensive bridge auto-unescape) is deferred to a follow-on task if this pattern persists after Option A lands.

## Acceptance Criteria

1. [ ] Audit: check all skill files, system prompts, and worker templates for any text that could encourage HTML encoding — document any found (binary deliverable: worker adds a findings note to this task file before proceeding)
2. [ ] Add explicit "no HTML encoding" instruction to TMCP agent-facing docs (help guide, communications guide, or worker skill as appropriate)
3. [ ] Unit test: verify the bridge does NOT decode HTML entities in `type: "text"` content (confirming Option A responsibility lies with the agent, not the bridge)

## Worker smoke-test note (not a gate-able AC)

After landing, manually send a `type: "text"` message containing `List<T>` and verify it renders as monospace `List<T>` not `List&lt;T&gt;`.

## Notes

- Confirmed: writing `<T>` directly renders correctly — bridge is not broken
- This is a documentation/behavior gap, not a bridge bug
- Low priority — cosmetic rendering issue only, no functional breakage

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial re-gate (post-refinement)
- checked: ACs 1-3 all binary (audit findings note deliverable ✓, doc instruction ✓, unit test verifying bridge passthrough ✓), Option B cleanly deferred, scope bounded to Option A doc fix, delegation complete
<!-- overseer-gate: PASS 2026-06-28 -->
