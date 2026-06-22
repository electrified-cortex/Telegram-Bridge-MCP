---
Created: 2026-05-28
Status: backlog
Priority: high
Source: Curator reproduction; filed 2026-05-28
---

# Bug: `checklist/update` action fails with undefined replace error

## Problem

`action(type: "checklist/update")` consistently fails with:

```
{"code":"UNKNOWN","message":"Cannot read properties of undefined (reading 'replace')"}
```

Reproduced 3x passing a full `steps` array with a valid `message_id`. Checklist creation via `send(type: "checklist")` works fine. Only the update path is broken.

## Acceptance Criteria

- [ ] Root cause identified: which field is `undefined` in the `replace` call within the checklist/update handler.
- [ ] Fix applied so `action(type: "checklist/update", message_id: <id>, steps: [...])` updates the checklist in place without error.
- [ ] Test added: create checklist → update steps → verify updated content returned.
- [ ] No regression on checklist creation path.

## Overseer bounce (2026-06-01)

- reviewer: Overseer SID-3
- verdict: REJECT — spec needs investigation before execution
- finding: Adversarial check found `update.ts` contains NO `.replace()` call anywhere in its code path. String operations are only `renderStatus`, `escapeHtml`, and `applyTopicToTitle`. Error origin is likely in one of these dependencies OR in the Telegram API wrapper. Also: repro description missing `title` field (required parameter) — its absence may be the actual trigger.
- action: Curator to investigate actual `.replace()` call site (check `applyTopicToTitle`, `escapeHtml`, or upstream Telegram wrapper). Update AC1 with correct root cause location. Also verify repro includes `title` field.
