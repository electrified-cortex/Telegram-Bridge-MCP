# 040 — Review LOOP-PROMPT.md

**Type:** Investigation (report only — no fixes)
**Priority:** 10

## Objective

Review `LOOP-PROMPT.md` for clarity, completeness, and accuracy. Report findings — do not make changes.

## Context

`LOOP-PROMPT.md` is the canonical loop recipe pasted by users to start a Telegram chat loop. It's referenced by `.github/agents/overseer.agent.md`. The file was last updated around v3.0.0 and may have stale or redundant content now that agent files (`.github/agents/`) carry role-specific instructions.

## Review Checklist

1. **Accuracy** — Do the setup steps match current tool behavior? Any outdated tool names or flows?
2. **Redundancy** — Which sections duplicate content already in `telegram-communication.instructions.md` or the agent files? Flag overlaps.
3. **Completeness** — Is anything missing that a first-time user would need to start a loop?
4. **Conciseness** — Any sections that could be trimmed without losing value?
5. **Instruction Precedence** — Does the precedence list still make sense given the current agent architecture?

## Deliverable

Add a `## Findings` section to this task file with your observations, organized by the checklist items above. Then move this file to `tasks/4-completed/2026-03-20/`.

## Findings

### 1. Accuracy

**Setup steps are incomplete vs. actual agent behavior.**

LOOP-PROMPT.md lists 5 setup steps: `get_agent_guide` → read resource → `get_me` → `session_start` → `dequeue_update`. Both agent files expand on this significantly:

- **Missing: `set_reminder`** — Both Overseer and Worker agent files require registering startup reminders immediately after `session_start`. LOOP-PROMPT.md makes no mention of this requirement. Since reminders don't persist across restarts, skipping them breaks idle behavior.
- **Missing: animation preset registration** — Worker must call `set_default_animation` for 4 named presets before entering the loop. Not mentioned in LOOP-PROMPT.md at all.
- **Missing: `list_sessions` + DM overseer** — Worker must identify the overseer and send an "online" DM before the loop. Not captured here.
- **`session_start` description is inaccurate** — the note "intro + handles pending messages" is misleading. `session_start` auto-drains pending messages from a previous session; it does not send an intro. The agent sends the intro separately (e.g., DM to overseer).
- **Loop animation references use informal names** — `(contextual:thinking)` and `(contextual:working)` are not actual API values. The real mechanism is `show_animation(preset: "{name}: thinking")` after presets are registered. A first-time user following this file would not know how to set that up.

### 2. Redundancy

**"Visible Presence" section is a verbatim duplicate** of the identically-titled section in `telegram-communication.instructions.md`. Since that instructions file already applies to all files (`applyTo: "**"`), this copy adds no value and can become stale.

**"Common Failure Modes" section is a verbatim duplicate** of the same section in `telegram-communication.instructions.md`. Same issue.

**Session flow / loop description overlaps** with `telegram-communication.instructions.md`'s "Session Flow" block, which covers the same `dequeue → handle → loop` pattern with more detail (voice ack, reaction rules, etc.).

**The "Loop" and "Canonical Recipe" subsections within LOOP-PROMPT.md itself overlap** — both describe the same dequeue loop in slightly different forms, creating internal redundancy.

### 3. Completeness

For a first-time user, the following are missing:

- **No mention of startup reminders** — omitting this causes agents to miss their self-monitoring behavior entirely.
- **No mention of animation preset registration** — without this, worker `show_animation(preset:...)` calls will fail silently.
- **No role-differentiation** — the file describes a generic loop, but different roles (Overseer vs. Worker) have meaningfully different startup sequences. The file doesn't acknowledge this gap or point users to the role-specific agent files for the extra steps.
- **No reconnect guidance** — `session_start` accepts `reconnect: true` for post-crash/compaction recovery. The agent files cover this under "Post-Compaction Recovery," but LOOP-PROMPT.md is silent. A user who references LOOP-PROMPT.md only would not know to pass this flag.
- **No failure path for `session_start`** — `get_me` failure is handled ("report the error and stop"), but `session_start` failure is not.

### 4. Conciseness

- **"Visible Presence" and "Common Failure Modes" should be removed entirely** — they duplicate `telegram-communication.instructions.md` and inflate the file without adding value.
- **The "Loop" and "Canonical Recipe" sections could be merged** — they describe the same behavior twice. One concise block is sufficient.
- The total file is short enough that trimming the two duplicate sections (≈15 lines) would make it genuinely minimal.

### 5. Instruction Precedence

The precedence list places "Loop-mode Telegram communication rules (this file + `telegram-communication.instructions.md`)" at #2, above "Role prompt (Overseer / Worker / custom)" at #3.

**This ordering is mildly inconsistent with actual use.** Both agent files already contain their own Telegram communication rules, and they reference LOOP-PROMPT.md only for the canonical loop recipe — not for communication rules. Placing role prompts below generic loop rules implies an agent should ignore role-specific guidance in favor of LOOP-PROMPT.md, which is the opposite of the intent.

A clearer formulation might be: role-specific agent files are authoritative; LOOP-PROMPT.md provides the loop skeleton that agent files extend. The precedence list currently obscures this relationship.

**"Memory notes — advisory only" is correct** and well-placed at #5.
