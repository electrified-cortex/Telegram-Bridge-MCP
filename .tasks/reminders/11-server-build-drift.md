# Server Build Drift

**Frequency:** Every 20 min | **Scope:** Overseer only

## Procedure

1. Call `get_me` and note the `mcp_commit` field (the running server's build hash).
2. Read `dist/tools/build-info.json` and note the `BUILD_COMMIT` field (the latest compiled build hash).
3. If they match, no action — the server is running the latest build.
4. If they differ:
   - Notify the operator: "Server is running build `{mcp_commit}` but `dist/` has `{BUILD_COMMIT}`. Restart to pick up changes?"
   - Use `confirm` with a single "Restart" button.
   - On approval: call `notify_shutdown_warning`, then `shutdown`.
   - On rejection: note the drift and check again next cycle.
5. If `dist/tools/build-info.json` does not exist (pre-build), skip silently.
