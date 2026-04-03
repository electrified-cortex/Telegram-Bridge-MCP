# Telegram Bridge MCP — Workspace Instructions

This repository **is** the Telegram Bridge MCP server. Edits to `src/` directly change the running MCP server.

## Starting a Session

Paste `LOOP-PROMPT.md` into this chat, or select the **Overseer** or **Worker** agent from the agents dropdown.

## Agent Roles

Agent-specific identity, behavior, reminders, and communication rules are defined in `.github/agents/`:

- **Overseer** (`.github/agents/overseer.agent.md`) — task board manager, operator liaison
- **Worker** (`.github/agents/worker.agent.md`) — task executor, implements and tests

## Changelog Maintenance

**Every commit that changes behavior must update [changelog/unreleased.md](../changelog/unreleased.md).**

- [Keep a Changelog](https://keepachangelog.com) format
- Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Deprecated`
- One line per change, past tense
- Include in the same commit as the code change — never a separate commit

## Token Economy

Minimize token use at every level:

- **Messages**: Concise. No filler.
- **Documentation**: Tables over prose, bullets over paragraphs.
- **Tool calls**: Batch reads, no redundant searches.
- **Commit messages**: One line, conventional format.

---

## Governance Rules (All Sessions, All Agents)

### Friction Protocol

Friction means something is missing — a tool, a doc, a prompt detail, or a misunderstanding. It is never something to push through.

- **One retry max.** If an operation fails, try ONE alternative approach. If that also fails, stop.
- **Never brute-force.** Do not retry the same failing command. Do not loop on errors. Do not guess past ambiguity.
- **Report up the chain.** When stuck, surface the issue to whoever dispatched you: what you tried, what failed, and what's needed to unblock.
- **Missing context = stop.** If files are missing, state is unexpected, or a spec is ambiguous — stop and ask rather than assuming.
- **Friction is signal.** Every friction event reveals a gap in tooling, documentation, or task definition. Flag it so it can be fixed at the source.

### Ask Don't Assume

Be inquisitive. The best outcomes come from understanding before acting. Ask clarifying questions rather than charging ahead with assumptions. The operator's context is complex and nuanced — respect that by confirming intent before making decisions.

### Document Everything

Every interaction, decision, discovery, and outcome that matters must be logged or committed. If it's not written down, it didn't happen. Be granular — don't wait until the end of a session to record what happened.

### No One-Off Complex Commands

Never run complex multi-step or multi-pipe commands directly in the terminal. Write a script file instead — it can be debugged, reviewed, and reused. Temp scripts go in `tools/temp/MMDD/`. Simple single-purpose commands (e.g. `git status`, `cd`, `ls`) are fine inline.

### Keep Workspace in High Order

Structure is not optional. Every file must be in the right place, every directory must have a clear purpose, and nothing should be orphaned or ambiguous.

- If a file doesn't clearly belong somewhere, flag it — don't leave it floating.
- All planned work is tracked as task documents. Nothing is done ad-hoc.
