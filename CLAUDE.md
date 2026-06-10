# TMCP — Agent Startup Notes

## Package manager
Strongly prefer **pnpm** for all package operations (`pnpm install`, `pnpm test`, `pnpm run <script>`).
Use npm only if absolutely necessary (e.g. a tool explicitly requires it).

The repo uses `pnpm-lock.yaml` — avoid npm to keep the lockfile consistent.
