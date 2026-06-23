---
Created: 2026-06-10
Status: stamped-pass
Gate: PASS (R2 — 2026-06-10)
Priority: 10
Target: 7.10.0
Delegation: foreman → worker
Branch: worker/10-2307-subsession-name-tag
Dev-branch: dev-7.10.0
---

# 10-2307 Sub-session `name_tag` not retained on spawn

## Problem

When `session/spawn-child` creates a child session it copies `name` and `color`
from the parent (lines 73–74 of `spawn-child.ts`) so the child presents as the
parent in Telegram. However, the parent's `name_tag` — an explicitly-set display
tag stored as `Session.name_tag?: string` — is never copied to the child.

The result is that a child session falls back to `defaultNameTag(session)` instead
of inheriting the operator-configured tag, causing the child to display differently
from the parent and breaking the "sub-sessions present as the parent" contract.

Operator directive: added to 7.10 scope (2026-06-10).

## Relevant Code

**`src/tools/session/spawn-child.ts`**

```
Line  6: import { setSessionParentSid, setSessionCapability, getSession } from "../../session-manager.js";
Line 13: export async function handleSpawnChild({ ... })
Lines 71-74:
  // Inherit parent's name and color. Sub-sessions present as the parent so the
  // operator sees one participant with multiple topic chips.
  const inheritedName = parentSession?.name ?? name;
  const inheritedColor = parentSession?.color;
Line 77: const result = await handleSessionStart({ name: inheritedName, color: inheritedColor, parentSid });
Line 81: const childSid = data.sid;
```

`childSid` is obtained by parsing the JSON response from `handleSessionStart`
(line 77–81). `getSession` is already imported on line 6 — no new import is needed.

**`src/session-manager.ts`**

```
Line 33: name_tag?: string;   // on the Session interface
```

The field is optional; when undefined, callers fall back to `defaultNameTag(session)`.

## Design

Insert the `name_tag` copy after line 86 (`setSessionCapability(childSid, cap)`), ensuring the child session is fully initialized before the tag is written.

```ts
// Inherit parent's name_tag so the child presents identically in Telegram.
if (parentSession?.name_tag !== undefined) {
  const childSession = getSession(childSid);
  if (childSession) {
    childSession.name_tag = parentSession.name_tag;
  }
}
```

No new imports are required: `getSession` is already imported from
`../../session-manager.js` on line 6.

Placement: after line 86 (`setSessionCapability(childSid, cap)`), before the
`setTopic` call on line 90. This keeps all child-session initialization together
and ensures the session object is fully registered before the tag is written.

## Acceptance Criteria

Tests go in `src/tools/session/spawn-child.test.ts` (existing file).

- [ ] **name_tag inherited**: Spawn a child session from a parent that has
  `name_tag` set to a non-empty string. Assert `getSession(childSid)?.name_tag`
  equals `parentSession.name_tag`.

- [ ] **name_tag absent — no crash**: Spawn a child from a parent whose `name_tag`
  is `undefined`. Assert `getSession(childSid)?.name_tag` is `undefined` (no
  default applied, no thrown error).

- [ ] **Regression — name and color unchanged**: Spawn a child and confirm
  `inheritedName` and `inheritedColor` are still derived from the parent exactly
  as before (existing behavior at lines 73–74 is unmodified).

- [ ] **Grep AC**: `grep "name_tag" src/tools/session/spawn-child.ts` returns at
  least one match.

## Out of Scope

- Propagating `name_tag` changes made to the parent after spawn (live sync).
- Exposing `name_tag` as a parameter on `SPAWN_CHILD_SCHEMA`.
- Any other `Session` field inheritance beyond `name_tag`.

## Notes

The `color` parameter in `SPAWN_CHILD_SCHEMA` is already documented as "ignored —
color is always inherited from the parent". `name_tag` follows the same pattern:
silently inherited, not caller-configurable on spawn.
