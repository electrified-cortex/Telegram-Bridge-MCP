# Worker Health

**Frequency:** Every 10 min | **Scope:** Overseer only

## Procedure

1. Call `list_sessions` to see all active worker sessions.
2. For each worker:
   - Has it sent a DM in the last 10 minutes? If yes, skip.
   - If silent >10 min, send a DM: "Status check — are you active?"
   - Ask workers what their active reminders are — this reveals what they're set up to do and catches misconfigured sessions.
   - If no response after two consecutive checks (~20 min), investigate: check terminal output, task progress, or error state.
3. If a worker appears hung (no progress, no response), notify the operator with context before taking action.
4. Never terminate a worker session without operator approval.
