---
title: "User Checklist — native interactive Telegram checklist (sendChecklist, Bot API 9.1)"
created: 2026-06-26
status: draft
priority: 20
type: Feature
source: Operator directive — Telegram feature audit triage (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: Bot API feature coverage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
feasibility: "BLOCKED — sendChecklist works only on behalf of a connected Telegram Business account; not sendable from a plain bot DM (confirmed against official changelog 2026-06-26)"
related:
  - src/tools/checklist/update.ts
---

# 20-0013 — User Checklist (native interactive checklist)

## Why this is a NEW feature, not a change to the existing checklist

The bridge already has a `checklist` send type
([src/tools/checklist/update.ts](../../src/tools/checklist/update.ts)), but it is
a **read-only status display**: the agent renders step states
(⬜ pending / 🔄 running / ✅ done / ⛔ failed / ⏭️ skipped) as an HTML message it
controls and edits. The operator cannot interact with it; it reports *agent*
progress.

Telegram's native checklist (`sendChecklist`, Bot API 9.1) is a different thing:
an **interactive** checklist the *operator* ticks off, where each tick comes back
to the bot as an update. The direction of control is reversed — it's a to-do list
the agent hands the operator, who acts on it.

These should remain **distinct and distinctly named**:

- existing `checklist` → agent-driven **status** display (unchanged)
- new **User Checklist** → operator-driven **interactive** checklist

(Operator naming directive, 2026-06-26: "These should be distinctly different
than what we already provide… called 'User Checklist'.")

## Feasibility study — COMPLETED 2026-06-26 → ❌ BLOCKED

**Verdict: not feasible under the current architecture.** Native Telegram
checklists can be sent **only on behalf of a connected Telegram Business
account** — a plain bot sending to a 1-on-1 DM (the bridge's model) cannot use
them. This is the same class of blocker as forum topics needing a supergroup.

### Evidence (official sources, verified 2026-06-26)

- **Bot API changelog, v9.1 (July 3, 2025)** —
  https://core.telegram.org/bots/api-changelog :
  > "Added the method **sendChecklist**, allowing bots to send a checklist **on
  > behalf of a business account**."
  > "Added the method **editMessageChecklist**, allowing bots to edit a checklist
  > **on behalf of a business account**."
- Both methods take a **required** `business_connection_id`, which only exists
  after a Telegram **Business** user connects the bot to their account (the
  `business_connection` update). Source: Bot API reference `sendChecklist` /
  grammY Business guide (https://grammy.dev/advanced/business).

### What this means for the bridge

- The current bridge talks to the operator over an ordinary **bot DM**, not a
  business connection. It has no `business_connection_id` to pass, so
  `sendChecklist` would fail.
- Native checklists are therefore **out of scope** unless the bridge gains a
  whole Telegram Business integration (operator on Telegram Premium/Business,
  bot connected as a business bot, `business_connection`/`business_message`
  update plumbing). That is a much larger architectural commitment than this
  feature warrants on its own.

### What would unblock this (not in scope here)

1. Operator has Telegram Premium and enables **Telegram Business**.
2. Operator connects this bot to their business account (grants `can_reply`).
3. The bridge captures the `business_connection_id` from the `business_connection`
   update and threads it through sends.

Only after a dedicated "business connection" epic exists would this feature
become buildable. Until then it stays parked.

### Disposition

- **Do not build** the design below as-is. It is retained as the spec to revive
  *if and when* a business-connection epic lands.
- The existing agent-status `checklist` type already covers the read-only display
  need and is unaffected.
- Recommend: leave in `needs-refinement` (operator asked to keep it in drafts),
  or move to `icebox` if the board prefers blocked items out of the draft lane.

## Goal (only if feasibility passes)

Add a `user_checklist` send type that posts an interactive checklist and routes
the operator's tick/untick and added-task events back to the agent.

## Proposed surface

```
type: "user_checklist"
title: z.string()
tasks: z.array(z.object({
  id: z.number().int(),     // stable task id
  text: z.string(),
})).min(1)
others_can_add_tasks: z.boolean().optional()
others_can_mark_tasks_as_done: z.boolean().optional()
```

Maps to `sendChecklist(chatId, InputChecklist)` with `InputChecklistTask[]`.

## Inbound wiring (the interactive half)

Native checklists generate **service updates** when the operator acts:
`checklist_tasks_done` and `checklist_tasks_added`. To make this useful:

- Add `checklist_tasks_done` / `checklist_tasks_added` (and whatever the live
  schema names them) to `DEFAULT_ALLOWED_UPDATES` in `src/telegram.ts` — these
  are **off by default** and will be silently dropped otherwise.
- Route them through the poller into the session queue as a new event kind so the
  agent learns which task ids were checked. Reuse `editMessageChecklist` if the
  agent needs to update the list afterward.

## Integration points

- `src/telegram.ts` — `DEFAULT_ALLOWED_UPDATES` additions; new send helper.
- `src/poller.ts` / event routing — classify and enqueue checklist update events.
- `src/tools/send.ts` — register `"user_checklist"` type + schema.
- New handler `src/tools/checklist/user-checklist.ts` (keep separate from the
  existing status `checklist/update.ts`).

## Acceptance criteria (gated on feasibility — currently ❌ BLOCKED)

- [x] Feasibility finding recorded (business-account requirement: **YES, required**)
      with a citation to the official Bot API changelog. → see Feasibility study above.
- [ ] BLOCKED: the criteria below require a Telegram Business connection epic first.
- [ ] If feasible: `send(type: "user_checklist", ...)` posts an interactive
      checklist distinct from the existing status checklist.
- [ ] Operator ticking a task delivers an event to the agent identifying the
      task id(s).
- [ ] New update types added to `allowed_updates` and routed (not dropped).
- [ ] Existing `checklist` status display is untouched.
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Scope boundary

- Does not modify or replace the existing agent-status `checklist` type.
- Filed under `needs-refinement` pending the feasibility gate.

## Notes

- grammY 1.43 targets Bot API 10.x, so `sendChecklist` / `editMessageChecklist`
  types should be present — but **the business-account constraint, not grammY
  support, is the blocker to resolve.**
