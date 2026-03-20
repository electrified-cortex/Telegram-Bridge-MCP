# Worker Health

**Frequency:** Every 10 min | **Scope:** Governor only

## Procedure

1. Call `list_sessions` to see all active worker sessions.
2. For each worker:
   - Has it sent a DM in the last 10 minutes? If yes, skip.
   - If silent >10 min, send a DM: "Status check — are you active?"
   - If no response after two consecutive checks (~20 min), investigate: check terminal output, task progress, or error state.
3. If a worker appears hung (no progress, no response), notify the operator with context before taking action.
4. Never terminate a worker session without operator approval.
