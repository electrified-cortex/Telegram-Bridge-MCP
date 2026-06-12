# Task: Implement `activity/file/touch` TMCP Action

**Priority:** PRI-0  
**Branch:** `worker/activity-file-touch-api-2026-05-23`  
**Status:** In progress

## Summary

Add `action(type: 'activity/file/touch', token: <session-token>)` to Telegram-Bridge-MCP.

Touches the registered activity file's mtime (utime()-style, no content change). Returns
`{ touched, file_path, mtime }` on success. Error codes: `NO_ACTIVITY_FILE`, `ACTIVITY_FILE_MISSING`, `AUTH_FAILED`.

## References

- Assignment: `.worker-pod/assignments/01-implement-activity-file-touch.md`

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-05-23
- **Verifier:** task-verification sub-agent (standard tier)
- **Commit:** `09c5809e feat(action): add activity/file/touch TMCP action`
- **Test gate:** 7/7 unit tests PASS, 3169/3169 full suite PASS
- **All ACs confirmed.** AC4 end-to-end with live monitor not captured as standalone integration test, but `utimes()` mechanism verified correct and consistent with existing TMCP activity behavior. Overseer's AC5 minor note accepted as non-blocking.
