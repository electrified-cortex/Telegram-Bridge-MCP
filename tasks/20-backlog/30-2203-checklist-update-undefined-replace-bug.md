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
