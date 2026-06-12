# Simplify Worker Pod recovery.md

**Created:** 2026-05-28 (operator-approved)
**Priority:** 30
**Delegation:** Curator-owned

## Context

Worker pods (4 total) currently have detailed task re-anchoring recovery content:
- Tail `audit-log.jsonl` for re-entry point
- Check `result.json`, `request.json`, `assignments/`
- Specific exit behavior on completion/failure

This is role-specific and fairly verbose. Operator wants it reviewed against the new foreman pattern and simplified.

## Canonical foreman recovery (non-Telegram v2):

```markdown
# Recovery

You compacted.

- Drain your inbox
- Post to your outbox that you compacted
```

## Task

Review whether worker recovery can adopt the same simple structure, or whether the task re-anchoring steps (audit-log, result.json, assignments) are genuinely necessary and should be preserved.

Worker pods are one-shot task executors — they may not have an inbox or outbox in the traditional sense. Determine what "drain your inbox" and "post to outbox" means for workers, or whether a different minimal pattern applies.

## Affected pods

- `electrified-cortex/Telegram-Bridge-MCP/.foreman-pod/.worker-pod/context/recovery.md`
- `electrified-cortex/skills/.foreman-pod/.worker-pod/context/recovery.md` (if still exists)
- `electrified-cortex/stations/stations/development/.overseer-pod/.foreman-pod/.worker-pod/context/recovery.md`
- `.live-stations/development/electrified-cortex/task-engine/pods/.foreman-pod/.worker-pod/context/recovery.md` (if still exists)

## Source

Operator voice 62923 — `tasks/00-ideas/recovery-propagation-go-voice-62923-2026-05-28.md`
