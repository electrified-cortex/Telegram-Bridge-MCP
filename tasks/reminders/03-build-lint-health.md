# Build & Lint Health

**Frequency:** Every 20 min | **Scope:** Governor only

## Procedure

1. Run `pnpm build`.
2. Run `pnpm lint`.
3. If either fails:
   - Identify the failing file(s) and error(s).
   - Check recent commits — was the regression just introduced?
   - Notify operator immediately with the error summary.
   - Create a task if the fix is non-trivial.
4. If both pass, no action needed — stay silent.
