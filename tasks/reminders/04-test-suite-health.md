# Test Suite Health

**Frequency:** Every 30 min | **Scope:** Governor only

## Procedure

1. Run `pnpm test`.
2. If failures:
   - Note which test(s) failed and the error messages.
   - Check if the failure is in code recently modified by a worker.
   - Notify operator with failure summary.
   - Create a task for fixes if non-trivial.
3. If all pass, no action needed — stay silent.
4. Track the test count — flag unexpected drops (deleted tests) or jumps (added without review).
