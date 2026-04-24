# Telegram Bridge MCP — Claude Code Instructions

See `.github/copilot-instructions.md` for changelog and merge policy.

## Agent Behavioral Guide

See [`docs/help/guide.md`](docs/help/guide.md) for the full agent behavioral guide — dequeue loop pattern, session startup, communication style, multi-session protocol, and shutdown flow.

## Loop Guard Hooks

Pre-built Stop hooks are included to keep agents in the dequeue loop:

- **VS Code / GitHub Copilot Chat:** `.github/hooks/telegram-loop-guard.json` + `.github/hooks/telegram-loop-guard.ps1`
- **Claude Code:** `.claude/hooks/telegram-loop-guard.sh`

See [`docs/agent-setup.md`](docs/agent-setup.md) for installation instructions.

## Dependency Policy

This repo has an established audit baseline (post-Grammy security audit, March 2026). All dependency changes are intentional and require review.

**Rules:**

- **No unilateral updates.** Do not run `pnpm update`, `pnpm upgrade`, or bump any dependency version without explicit operator approval.
- **New dependencies require operator approval** before being added.
- **Automated PRs (Renovate, Dependabot) must NOT be auto-merged.** All automated dependency PRs require manual review and operator sign-off.
- **Exception: patch-only security fixes.** A patch version bump that fixes a known CVE and produces a clean `pnpm audit` result may be applied without waiting for full review (e.g. the path-to-regexp fix in #134). Document the CVE and audit result in the commit message.

When in doubt, ask the operator before touching `package.json` or `pnpm-lock.yaml`.
