# Telegram Bridge MCP — Agent Roster

Agent definitions live in `.github/agents/`. Each file defines a role — its identity,
responsibilities, tools, and behavioral rules.

---

## Persistent Agents

These agents run as long-lived sessions connected to the Telegram bridge.

| Agent | File | Role |
|---|---|---|
| **Overseer** | `agents/overseer.agent.md` | Task board manager, operator liaison, git authority |
| **Worker** | `agents/worker.agent.md` | Task executor — implements, tests, commits |

---

## Subagents (Stateless)

These agents are dispatched for a specific task and return a report. They do not maintain
a Telegram session.

| Agent | File | Role |
|---|---|---|
| **Task Runner** | `agents/task-runner.agent.md` | General-purpose implementation executor |
| **Code Reviewer** | `agents/code-reviewer.agent.md` | Standard code review — correctness, style, coverage |
| **Adversarial Reviewer** | `agents/adversarial-reviewer.agent.md` | Skeptical review — assumes the implementation is wrong until source-verified |

---

## Task Subagents

Specialized subagents for common recurring tasks. Dispatched by the Overseer or Worker.

| Agent | File | Purpose |
|---|---|---|
| **Build + Lint** | `agents/task-build-lint.agent.md` | Run build and linting checks |
| **Changelog Audit** | `agents/task-changelog-audit.agent.md` | Verify changelog entries are present and correct |
| **Doc Hygiene** | `agents/task-doc-hygiene.agent.md` | Check documentation completeness and accuracy |
| **Markdown Lint** | `agents/task-markdown-lint.agent.md` | Lint markdown files for formatting issues |
| **Task Pickup** | `agents/task-pickup.agent.md` | Scan and claim tasks from the queue |
| **PR Health** | `agents/task-pr-health.agent.md` | Check pull request status and CI |
| **PR Review** | `agents/task-pr-review.agent.md` | Review a pull request diff |
| **Release PR** | `agents/task-release-pr.agent.md` | Create a release pull request |
| **Test Suite** | `agents/task-test-suite.agent.md` | Run the test suite and report results |

---

## Adversarial Reviewer — When to Use

The Adversarial Reviewer is used when standard code review is not enough — specifically when:

- The change touches critical paths (session management, auth, message routing)
- A previous review was too lenient and issues slipped through
- The task is complex enough that a second skeptical perspective is warranted
- The Overseer or Worker wants an adversarial challenge before merging

Dispatch with: `runSubagent(agentName: "Adversarial Reviewer")` — pass changed files, the task
summary, and "Be adversarial. Assume the implementation is wrong."

Output format: `RISKS` / `FLAWS` / `RECOMMENDATIONS` / `VERDICT`
