# Test fix dispatch — 2026-04-18

**Role:** Dispatch agent. Zero-context. Read this file, do the work, report.

**Repo:** `D:\Users\essence\Development\cortex.lan\Telegram MCP` (branch: `dev`).

**Hard constraints:**

- Do NOT `git commit`, `git stage`, `git add`, or `git push`. Anything.
- Edit ONLY `.test.ts` files unless a source file is clearly broken (in which case stop and report without editing src).
- Do not change expected behavior. If a test's *intent* looks wrong, report it — do not rewrite it.
- Run `pnpm test <file>` after each edit to verify.

**The problem:** 39 tests failing across 7 test files after recent merges (#145 service-message rewrite, shutdown changes). Most are stale assertions — assertion text or mock setup doesn't match the current `SERVICE_MESSAGES` or shutdown behavior.

**Failing files (handle in this order, one at a time):**

1. `src/tools/session_start.test.ts` (3 failures)
   - `session_start tool > first session: injects onboarding_role with governor text`
   - `session_start tool > first session: injects onboarding_protocol after session_orientation`
   - `session_start tool > session/start service message to fellow says 'has joined'`

2. `src/tools/shutdown.test.ts` (2 failures)
   - `shutdown tool > returns warning (not error) when global queue has items and force is not set`
   - `shutdown tool > bypasses pending guard when force: true`

3. `src/shutdown.test.ts` (11 failures — whole `elegantShutdown` describe)

4. `src/behavior-tracker.test.ts` (4 failures — nudges)

5. `src/built-in-commands.test.ts` (1 failure — `governor:set` callback)

6. `src/health-check.test.ts` (2 failures — governor_changed notifications)

7. `src/tools/close_session.test.ts` (1 failure — governor_promoted service message)

8. `src/local-log.test.ts` (12 failures — rollLog, concurrent flush, deleteLog). **WARNING:** tests appear to run twice (each assertion pair listed twice). May indicate test-isolation issue. Investigate before editing — might be a real bug, not a stale assertion.

**Expected root causes:**

- Test asserts old SERVICE_MESSAGES wording; current content is in `src/service-messages.ts` (read to find the actual current text).
- Test expects old shutdown signature; current signature may use `deliverServiceMessage(sid, ENTRY_OBJECT)` single-object form.
- Test mocks `deliverServiceMessage(sid, text, eventType)` positionally; entries may now be `{text, eventType}` bundles.

**What to do per file:**

1. Read the test file + its subject source file (e.g. session_start.test.ts ↔ session_start.ts).
2. Read `src/service-messages.ts` if the test asserts SERVICE_MESSAGES content.
3. Identify the drift. Update test assertions to match current behavior.
4. Run `pnpm test <file>` → verify green.
5. Move to next file.

**Report format (the only thing you return to me):**

```txt
## session_start.test.ts
- Fix: <what you changed, 1 line>
- Verified: PASS (N/N) or FAIL — <reason>

## shutdown.test.ts
...
```

Keep each entry terse. Flag any file where you think the test intent is wrong or the src code has a real bug (report, don't fix src).

**When done:** report. Do not commit. Do not push. Do not stage.
