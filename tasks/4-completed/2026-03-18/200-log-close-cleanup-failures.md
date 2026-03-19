# Log close_session Callback Cleanup Failures

**Type:** Bug / Observability
**Priority:** 200 (Medium)

## Description

When `close_session` replaces callback hooks on orphaned inline keyboards, errors from `editMessageReplyMarkup` are silently swallowed with `.catch(() => {})`. This makes debugging cleanup failures impossible.

## Current Behavior

```typescript
void getApi().editMessageReplyMarkup(chatId, target, {...}).catch(() => {});
```

No error is logged — cleanup failure is invisible.

## Desired Behavior

Log the error to stderr or via `dlog` for observability:

```typescript
.catch((err: unknown) => {
  dlog("cleanup", `callback hook cleanup failed for msg ${target}: ${String(err)}`);
});
```

## Code Path

- `src/tools/close_session.ts` — callback hook replacement in the close handler
- `src/message-store.ts` — `replaceSessionCallbackHooks()` if cleanup happens there

## Acceptance Criteria

- [ ] Cleanup errors are logged (stderr or dlog)
- [ ] Silent `.catch(() => {})` replaced with logging catch
- [ ] No functional behavior changes — close still succeeds even if cleanup fails
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
