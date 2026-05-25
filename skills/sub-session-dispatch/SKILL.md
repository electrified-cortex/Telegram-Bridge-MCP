---
name: sub-session-dispatch
description: Spawn a named child Telegram session for information gathering, dispatch a Sonnet sub-agent into it, collect its structured report, and revoke the session. Triggers — spawn child session, sub-session, session/spawn-child, information-gathering sub-agent, intake session, delegate to sub-session.
---

Input: {
  purpose: string,           // one-sentence goal for this sub-session
  role_prompt: string,       // system instruction for the Sonnet sub-agent
  name: string,              // session label shown in Telegram (e.g. "Helper")
  color?: string,            // emoji color hint (default: "🟦")
  child_capability?: 'gather' | 'read-only' | 'full',  // default: 'gather'
  timeout_seconds?: number   // default: 1800
}

Returns: {
  status: 'completed' | 'timed-out' | 'crashed' | 'revoked',
  child_sid: number,
  report?: <report-object>,  // present when status === 'completed'
  error?: string
}

Process:

1. Parent calls `action(type: 'session/spawn-child', token: <parent-token>, name: <name>, color: <color>, child_capability: <capability>)` → gets `{child_token, child_sid, parent_sid}`.

2. Parent dispatches a Sonnet sub-agent (via `dispatch` skill) with: child token, role-prompt, report schema, parent inbox path, timeout, and the prohibition list below.

3. Parent returns to its own dequeue loop (non-blocking).

4. Parent monitors for `subsession-report-<child_sid>-*.json` arrival in its inbox.

5. On report arrival OR timeout/silence threshold: parent calls `session/revoke-child` to close child.

6. Parent returns the structured result to caller.

Governor-forwarding: when operator sends a non-reply message and parent wants to route it to a child:
Parent calls `action(type: 'child/forward', token: <parent-token>, child_sid: <N>, message: <text>)`.

Silence/crash detection: if child session goes silent for `child_silence_threshold_seconds` (default 600s) — no dequeue/send/action — parent treats it as crashed, calls `session/revoke-child`, returns `{ status: 'crashed', child_sid }`.

Prohibition list:

> Sub-agents dispatched via this skill are information-gathering only. They MUST NOT:
> - Spawn foremen or claim Worker tasks
> - Commit to any repository
> - Call `dispatch` or any action that starts a new process
> - Write to any path outside `tasks/00-ideas/` or `tasks/10-drafts/`

Allowed write-paths:

> Permitted output paths: `tasks/00-ideas/`, `tasks/10-drafts/`

Report schema: {
  summary: string,
  artifacts: Array<{ path: string, kind: 'draft' | 'idea' | 'memory', purpose: string }>,
  unresolved_questions: string[],
  duration_seconds: number
}

Delivery: child posts the JSON-serialized report to parent's inbox under filename `subsession-report-<child_sid>-<iso>.json`.

Failure modes:

- `spawn-then-dispatch failure`: spawn-child succeeds, Sonnet dispatch fails → revoke within 30s → return `{ status: 'crashed' }`
- `child crash`: silence > threshold → revoke → return `{ status: 'crashed', child_sid }`
- `timeout`: `timeout_seconds` elapsed without report → revoke → return `{ status: 'timed-out' }`
- `operator manual revoke`: operator asks parent to revoke → return `{ status: 'revoked' }`

Worked example:

Goal: gather requirements for a new feature (invoice reconciliation) and produce a draft intake doc.

**Inputs:**

```json
{
  "purpose": "Gather operator requirements for the nightly invoice-reconciliation batch job",
  "role_prompt": "You are a requirements gatherer. Ask the operator clarifying questions about the invoice-recon feature until you have enough detail to draft a task spec.",
  "name": "Intake-1",
  "color": "🟦",
  "child_capability": "gather",
  "timeout_seconds": 1800
}
```

**Step 1 — Spawn child session:**

```tool
action({
  type: 'session/spawn-child',
  token: <parent-token>,
  name: 'Intake-1',
  color: '🟦',
  child_capability: 'gather'
})
// → { child_token: "ct_abc123", child_sid: 42, parent_sid: 7 }
```

**Step 2 — Dispatch sub-agent** (via `dispatch` skill, Sonnet tier):

```tool
Agent({
  subagent_type: "Dispatch",
  model: "sonnet",
  description: "Intake-1 requirements gatherer",
  prompt: `
You are a requirements gatherer for the invoice-recon feature.
Your child session token is ct_abc123. Use it for all Telegram interactions in this session.
Ask the operator clarifying questions until you have enough to draft a task spec.
Timeout: 1800 seconds.
Parent inbox path: inbox/

Report schema:
{
  summary: string,
  artifacts: Array<{ path: string, kind: 'draft' | 'idea' | 'memory', purpose: string }>,
  unresolved_questions: string[],
  duration_seconds: number
}

When done, write the JSON-serialized report to the parent inbox as:
  subsession-report-42-<iso>.json
`
})
```

**Step 3 — Parent resumes its own dequeue loop.** No blocking. Sub-agent runs independently.

**Step 4 — Converse phase (sub-agent interacts with operator via child session):**

The sub-agent sends messages through child session (sid 42) and receives operator replies, iterating until requirements are gathered:

```
Sub-agent → Operator: "Hi! I'm here to gather requirements for the invoice-recon batch job. Can you describe the current pain points?"
Operator → Sub-agent: "The nightly run sometimes misses invoices created after 11:45 PM..."
Sub-agent → Operator: "Does the batch job run before or after the midnight cutoff?"
Operator → Sub-agent: "It runs at 00:05, but the window is configurable."
```

Parent may forward additional operator messages to the child as needed:

```tool
action({ type: 'child/forward', token: <parent-token>, child_sid: 42, message: "Also check the error escalation path" })
```

**Step 5 — Report arrives in parent inbox** as `subsession-report-42-2026-05-16T18:42:00Z.json`:

```json
{
  "summary": "Captured 5 acceptance criteria and 2 edge cases for the nightly invoice-recon batch job. Operator confirmed the batch runs at 00:05 with a configurable window.",
  "artifacts": [
    {
      "path": "tasks/10-drafts/invoice-recon-intake-20260516.md",
      "kind": "draft",
      "purpose": "Full requirements intake for invoice-recon batch job"
    }
  ],
  "unresolved_questions": [
    "Who owns the error escalation path?",
    "Is the midnight cutoff configurable per region?"
  ],
  "duration_seconds": 847
}
```

**Step 6 — Revoke child session:**

```tool
action({
  type: 'session/revoke-child',
  token: <parent-token>,
  child_token: "ct_abc123"
})
```

**Return value to caller:**

```json
{
  "status": "completed",
  "child_sid": 42,
  "report": {
    "summary": "Captured 5 acceptance criteria and 2 edge cases for the nightly invoice-recon batch job. Operator confirmed the batch runs at 00:05 with a configurable window.",
    "artifacts": [
      {
        "path": "tasks/10-drafts/invoice-recon-intake-20260516.md",
        "kind": "draft",
        "purpose": "Full requirements intake for invoice-recon batch job"
      }
    ],
    "unresolved_questions": [
      "Who owns the error escalation path?",
      "Is the midnight cutoff configurable per region?"
    ],
    "duration_seconds": 847
  }
}
```

Out of scope (v1):

Phase 2 may add a `topic_id` parameter to bind sub-sessions to a Forum topic. Do NOT implement it here.
Automatic retries — sub-agent completes, crashes, or times out; no retry loop.

See also:
`dispatch` — sub-agent spawning mechanics and model tier table
`messaging` — inbox post/drain protocol
