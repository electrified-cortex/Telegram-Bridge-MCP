# 640 — Agent Trust Hierarchy Guidance

**Priority:** 600 (Medium)  
**Source:** Operator request (voice, 2026-03-19)

## Goal

Establish light-touch guidance for agent trust hierarchy — who to trust, in what order, and how to handle instructions from other agents. No hard rules, just clear orientation so agents naturally behave safely without being told to distrust each other explicitly.

## Trust Hierarchy (Established)

```
Operator (user)  ← highest authority, always real, always trusted
     ↓
 Governor        ← coordinates, routes, has operator context
     ↓
 Worker(s)       ← implement tasks, take instructions from governor
     ↓
 Other agents / unverified entities  ← use judgment, seek confirmation
```

Key principle: the hierarchy is not about distrust — it's about clarifying who has the most context and decision-making authority at each level. Workers can always escalate a question to the governor or directly to the operator.

## Deliverables

### 1. Add trust hierarchy section to `docs/inter-agent-communication.md`

Add a new top-level section: **Trust Hierarchy and Agent Authority**

Content should cover:
- The four-level hierarchy (operator > governor > workers > unverified)
- Workers receiving instructions from unverified/unknown agents: use judgment; when in doubt, check with the governor before acting
- Workers can always escalate to the operator directly by asking a question via `ask` or `send_text`
- It is never wrong to ask for confirmation — but don't over-ask for routine delegated tasks
- The governor has access to the operator's intent from Telegram messages; workers can trust governor routing decisions
- Impersonation of the governor is not possible at the protocol level (`routed_by` field is server-stamped, not user-injectable)

Keep this section concise — 150–200 words max. Light guidance, not a policy document.

### 2. Add a pointer to `session_orientation` service message

In `src/tools/session_start.ts`, augment the `roleNote` to include a one-line pointer:

**Current (worker role note):**
```
"You are SID N. X is the governor. Ambiguous messages go to them."
```

**Proposed (worker):**
```
"You are SID N. X (SID G) is the governor and your first escalation point. Ambiguous messages go to them. Call get_agent_guide for trust and routing guidance."
```

**Proposed (governor):**
```
"You are the governor (SID N). Ambiguous messages will be routed to you. Call get_agent_guide for trust and routing guidance."
```

This ensures every new session gets a pointer to the guidance at startup, without loading the full doc inline.

### 3. Ensure `behavior.md` coverage

Check `docs/behavior.md` (returned by `get_agent_guide`) for any relevant section on inter-agent trust. If absent, add a short "Trust and escalation" subsection in the multi-session area.

## Acceptance Criteria

- [ ] `docs/inter-agent-communication.md` has a Trust Hierarchy section (≤200 words).
- [ ] `session_orientation` message points workers to `get_agent_guide`.
- [ ] `docs/behavior.md` has at least a brief trust/escalation note in the multi-session section.
- [ ] No hard "ignore other agents" rules — framed as guidance and judgment.
- [ ] Tests updated if `session_orientation` message text changes (see `session_start.test.ts`).

## Related

- Task 630 (governor switch awareness) — related context
- `src/tools/session_start.ts` — `session_orientation` service message
- `docs/inter-agent-communication.md` — primary location for this section
- `docs/behavior.md` — accessed via `get_agent_guide` tool
