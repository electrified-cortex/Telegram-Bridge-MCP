# reminder-driven-followup spec

## Purpose

Define the reminder-first delegation pattern that prevents async work from falling through the cracks. Every delegated dispatch or async tool invocation gets a verification reminder created BEFORE the dispatch, so the agent has a guaranteed callback to check status even if the dispatchee never reports back.

This skill exists because Telegram session agents do not have a built-in "wait for that to finish" primitive — without an explicit reminder, an async dispatch can be silently forgotten.

## Scope

Applies whenever an agent delegates work to another session (DM, task assignment) or fires a long-running async dispatch whose result the agent needs to confirm.

Does NOT cover:

- Synchronous tool calls whose result is immediate.
- Operator-direct interactions (operator owns their own follow-up cadence).
- Cron-style scheduled tasks owned by the bridge or host runtime.

## Requirements

R1. The skill MUST present the core pattern in five steps:
   1. Create verification reminder (FIRST, before dispatch).
   2. Dispatch the work.
   3. On reminder fire → check status of the dispatchee.
   4. If done → cancel reminder. If not done → follow up with dispatchee, optionally re-arm.
   5. On dispatchee confirmation → cancel reminder if not already.

R2. The skill MUST state the reminder-first ordering explicitly: never dispatch first then create the reminder. A failed reminder creation discovered AFTER dispatch leaves the work uncovered.

R3. The skill MUST cover the recurring-reminder flag: when to re-arm vs one-shot.

R4. The skill MUST instruct on dedup-by-id usage when re-arming so the reminder doesn't pile up.

R5. The skill MUST cross-reference `help('action')` for the canonical reminder lifecycle calls (`reminder/set`, `reminder/cancel`, `reminder/disable`, `reminder/sleep`).

## Constraints

C1. Runtime card under ~120 lines.

C2. Use generic role labels (dispatching-agent / dispatched-agent) — NOT workspace-specific names like Curator/Overseer/Worker.

C3. Reminder text guidance is structural ("verification of <work>") not specific examples that would imply a specific fleet topology.

## Don'ts

DN1. Do NOT instruct agents to use reminders as a substitute for dequeue-loop responsiveness. Reminders cover async dispatch, not main loop liveness.
DN2. Do NOT introduce a "fire and forget" exception. Every async dispatch gets a reminder.
DN3. Do NOT bake fleet-specific timing (e.g. "30 minutes for Workers") — the skill covers the pattern, not domain-specific intervals.
