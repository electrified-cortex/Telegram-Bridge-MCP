# Feature: Session-Scoped Slash Commands

## Type

Feature / UX

## Priority

300

## Description

Each agent can call `set_commands` to register slash commands (e.g., `/cancel`, `/status`). When two agents both register `/cancel`, Telegram shows a single `/cancel` in the autocomplete — but which session handles it when the operator taps it?

Currently: the command arrives as a regular message through `dequeue_update`. Routing treats it like any other message — if ambiguous (no reply-to), it goes to the governor. This means session 2's `/cancel` command might get handled by session 1 (the governor).

Need a strategy for command namespacing, routing, or scoping.

## Options

### Option A: Namespace commands per session

Each session's commands get a prefix: `/worker_cancel`, `/overseer_cancel`. The server auto-prepends the session name. Clear but verbose.

### Option B: Route commands to the registering session

Track which session registered each command. When the operator taps `/cancel`, route it to the session that registered it. If multiple sessions registered the same command, route to the most recent registrant (or the governor).

### Option C: Merge and scope via governor

Governor registers all commands. Individual sessions don't touch `set_commands`. Governor triages command events like any other message.

### Option D: Do nothing (current behavior)

Commands route like messages. Governor handles ambiguous ones. Agents that need their own commands can check if the command is "theirs" and ignore otherwise.

## Recommendation

Option D (do nothing) is fine for now. Governor routing already handles dispatch. Document the behavior and move on. If it becomes a real problem with real multi-session usage, revisit with Option B.

## Acceptance Criteria

- [ ] Document current slash command routing behavior in behavior.md
- [ ] Add guidance for agents on slash command etiquette in multi-session
- [ ] Optionally: implement per-session command tracking (Option B) if needed
