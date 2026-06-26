---
Created: 2026-06-13
Updated: 2026-06-13
Status: Draft
Host: local
Priority: High
Source: Operator (voice, sub-session SID 3 token 3278778, 2026-06-13)
Target: V8 (pre-release gate)
---

# V8 Tech Debt Cleanup — Full Codebase Refactor & Refinement

## Objective

Before shipping V8, conduct a broad codebase sweep to eliminate tech debt,
tighten code quality, remove dead code, and bring every corner of the codebase
up to the standard that V8 deserves. The goal is not new features — it is
making the existing code honest, clean, and maintainable.

This is a deployment-of-agents epic. Work is parallelizable across many
independent concerns and should be dispatched to multiple background agents,
with curator/BT review before any merge.

Operator directive (2026-06-13, distilled): TMCP is feature-stable. V8 should
feel like a major release not because of new features alone but because the
code behind it is genuinely clean. Run every category of review in parallel.
Fix everything that's safe to fix. Document what's out of scope for V8.

---

## Scope

### 1. Silent error suppression audit

**Source:** 2026-05-27 refactor scan (`notes/2026-05-27-refactor-scan.md`)

The scan found 50+ `catch { /* ignore */ }` blocks throughout the codebase,
concentrated in `src/built-in-commands.ts`. Silent swallowing of Telegram API
rejections is the single highest-risk tech debt item.

Tasks:
- Enumerate every `catch` block that discards errors without logging.
- For each: determine if silence is intentional (cosmetic, fire-and-forget)
  or a latent bug risk (Telegram rejection, state corruption).
- Replace high-risk silent catches with `dlog()` calls.
- For cosmetic/intentional cases: add a comment explaining why silence is
  correct so future reviewers don't re-investigate.
- Add `validateText()` length checks before every `sendMessage` call in
  `built-in-commands.ts` panels (lines 85–504).

**Acceptance:** No unintentional silent error swallowing in hot paths.
Every silent catch that remains has a comment justifying it.

---

### 2. Dead code removal

**Source:** 2026-05-27 refactor scan

- `src/tools/_retired/edit_message_text.ts` — deprecated tool still registered
  in `action.ts` (~73 lines). Remove the file and unregister from the
  dispatcher.
- Review `src/tools/_retired/` for any other artifacts that were retired but
  never purged.
- Scan for any TODO comments referencing superseded designs (identified by the
  help coverage audit as a known issue for `src/`).
- Remove the stale dequeue TODO at `src/tools/dequeue.ts:246` that was flagged
  in the refactor scan (pending hint suppression — task 20-2106 handles the
  feature; the TODO comment itself should either reference that task or be
  removed).

**Acceptance:** `_retired/` contains no actively registered code. All stale
TODOs either link to a task or are removed.

---

### 3. Button and input validation hardening

**Source:** 2026-05-27 refactor scan

- `src/tools/button-helpers.ts` `buildKeyboardRows()` does not validate
  Telegram limits: 64-char max for `callback_data`, 64-char max for button
  label. Silent rejection risk.
- Consolidate button validation: add length checks inside `buildKeyboardRows()`
  so all callers benefit automatically.
- `src/tools/send/file.ts:72–92`: Fragile voice file validation uses a manual
  `http://` check. Consolidate URL/file-type detection into a shared utility.
- `src/tools/profile/voice.ts`: No verification that a voice name exists in
  the TTS system before persisting to profile. Add existence check or at least
  a warning.
- `src/tools/activity/file-state.ts`: Activity file metadata written without
  runtime schema validation. Add schema guard on write.

**Acceptance:** All button/input validation failures produce a clear error
message rather than a downstream Telegram rejection.

---

### 4. Hardcoded strings → constants

**Source:** 2026-05-27 refactor scan

- `src/tools/session/start.ts:542` — reconnect path uses hardcoded strings
  instead of `SERVICE_MESSAGES` constants.
- Scan `src/` broadly for other hardcoded user-facing strings that should be
  in a constants file.

**Acceptance:** User-facing strings in the reconnect path use `SERVICE_MESSAGES`
constants. No new hardcoded user-visible strings found outside constants files.

---

### 5. `built-in-commands.ts` structural review

**Source:** 2026-05-27 refactor scan

At 1590 lines, `built-in-commands.ts` is the only file flagged as having a
clear split case. The scan recommends splitting into panels/handlers
subdirectories.

Tasks:
- Map the logical groupings within `built-in-commands.ts` (e.g., by command
  category or UI panel type).
- Propose a split structure (subdir names, file responsibilities).
- Implement the split behind a worktree. Tests must pass after split.
- Do not change behavior — structural split only.

This task requires a worktree (multi-file refactor).

**Acceptance:** `built-in-commands.ts` is replaced by a subdirectory structure.
All tests pass. No behavioral change.

---

### 6. Code comment accuracy pass

**Source:** Epic 10-2107 (V8 Help Coverage)

Inline comments in `src/` that describe behavior must match actual behavior.
This is distinct from the help doc accuracy work in epic 10-2107 — this
concerns source-level comments only.

Tasks:
- Audit inline comments in the highest-churn files: `session-manager.ts`,
  `dequeue-endpoint.ts`, `outbound-proxy.ts`, `session-queue.ts`,
  `session-context.ts`.
- Flag comments that reference v6/v7 behavior that has since changed.
- Update or remove stale comments.

**Acceptance:** No inline comments describe behavior that no longer exists.

---

### 7. Test suite hygiene

**Source:** Epic 10-2107 (V8 Help Coverage) + 2026-05-27 refactor scan

- Remove tests for action paths that no longer exist.
- Close the `session/spawn-child` capability check gap (R8 from
  `spawn-child-service-message-chain`): two test paths needed — one via
  action-dispatch, one via direct MCP tool call.
- Audit `.test.ts` files for tests that duplicate each other or test internal
  implementation details that have since been refactored away.
- Ensure every R*/AC item in shipped specs (the `.md` spec files alongside
  `.ts` source files, e.g., `animation-state.ts.md`) has at least one test.

**Acceptance:** `pnpm test` passes clean. No dead tests. `spawn-child`
capability R8 gap closed.

---

### 8. Security audit

**Context:** A prior adversarial GPT-5.4 review (2026-05-04, `notes/2026-05-04-tmcp-7.4-adversarial-gpt-codex-review.md`)
found a high-severity file-write primitive exposed via `activity/file-state.ts`.
That review was scoped to a single release diff. This section calls for a
full-codebase security pass at V8 cut.

Dispatch an adversarial Opus-level sub-agent with the following mandate:

**Scope:**
- Review the full `src/` tree (not just a diff) for:
  - **Injection risks** — any place where operator/agent input reaches a shell
    command, filesystem path, template string, or Telegram API field without
    sanitization (path traversal, null bytes, format strings, oversized values).
  - **Authentication/authorization gaps** — places where a session token
    grants access beyond its intended scope. Specifically re-examine the
    `activity/file-state.ts` path append primitive (H1 from prior review) to
    confirm it was fully addressed or still requires remediation.
  - **Token leakage** — any logging, error message, or HTTP response that
    could expose bot tokens, session tokens, or API keys.
  - **Dependency vulnerabilities** — known CVEs in direct and transitive
    dependencies. Cross-reference with current `pnpm audit` output and
    public vulnerability databases for the Node.js + Telegram bot ecosystem.
  - **Race conditions in state** — shared mutable state (Map instances,
    session-queue, animation-state) that could be corrupted under concurrent
    operations.
  - **DoS vectors** — unbounded loops, unbounded queues, or missing rate
    limits that could be triggered by a malicious or runaway agent.
  - **SSE/HTTP endpoint exposure** — verify that all HTTP endpoints
    (SSE, health-check, event-endpoint) are gated appropriately and cannot
    be reached without valid authentication.

**Format:** The reviewing agent should produce a findings document in
`notes/` following the format of the prior adversarial review:
`notes/2026-06-13-v8-security-audit.md`, with findings categorized as
Critical / High / Medium / Low. Each finding must include: file + line range,
description, why it is real (not theoretical), and a recommended fix.

**Scope encouragement:** The reviewing agent is explicitly encouraged to expand
scope beyond this list if they identify additional risk surfaces during the
review. The mandate is comprehensive coverage, not just this checklist.

**Acceptance:** Findings document produced. All Critical and High findings
either fixed before V8 ships or explicitly triaged with a rationale for
deferral. Medium/Low findings tracked in backlog or accepted with documented
rationale.

---

### 9. TypeScript strictness audit

Tasks:
- Run `tsc --strict` (or check current tsconfig for loose flags) and identify
  any `any` types, non-null assertions (`!`), or type casts (`as X`) that
  could be eliminated.
- Focus on the tool handler layer (`src/tools/**`) where type safety is most
  valuable for correctness.
- Do not enable flags that would require large cascading changes — document
  those for a V9 task instead.

**Acceptance:** All identified quick-win `any` types in tool handlers replaced
with proper types. A note filed for any strict flags that require deeper work.

---

### 9. Dependency and version hygiene

Tasks:
- Review `package.json` for:
  - Unpinned/floating version ranges that could cause surprise upgrades.
  - Dependencies that are imported but unused.
  - Outdated versions with known issues (cross-reference `pnpm audit`).
- grammY `^1.43.0`: note that 10.1 support is not yet available (tracked by
  epic 10-3001). Do not upgrade grammY as part of this epic unless a safe
  minor is available.

**Acceptance:** `pnpm audit` reports no high/critical vulnerabilities.
No unused imports in `package.json`.

---

### 10. Logging consistency audit

Tasks:
- `src/debug-log.ts` defines `dlog()`. Verify it is used consistently in
  preference to `console.log`/`console.error` in non-startup code.
- Identify any `console.*` calls in hot paths (dequeue loop, send paths,
  session manager) and replace with `dlog()`.
- Verify log categories are consistent with the documented categories
  (`session`, `route`, `queue`, `cascade`, `dm`, `animation`, `tool`,
  `health`).

**Acceptance:** No `console.*` in hot paths outside test setup. `dlog()`
categories match the documented set.

---

## Out of scope (V8)

- New features not already in the backlog.
- The Bot API 10.1 rich messages integration (epic 10-3001).
- Help doc coverage (epic 10-2107) — that epic handles `docs/help/` content;
  this epic handles source code only, except where they overlap on comment
  accuracy.
- grammY upgrade to support 10.1 — tracked by epic 10-3001.
- Splitting files other than `built-in-commands.ts` — the scan found the
  other large files acceptable as monoliths.

---

## Delivery approach

This epic is designed for parallel agent dispatch. Each numbered section is a
largely independent workstream. Recommended dispatch:

| Agent | Sections |
|---|---|
| Agent A | §1 (silent catches) + §4 (hardcoded strings) |
| Agent B | §2 (dead code) + §7 (test hygiene) |
| Agent C | §3 (validation hardening) |
| Agent D | §5 (built-in-commands split) — worktree required |
| Agent E | §6 (comment accuracy) + §11 (logging) |
| Agent F | §9 (TypeScript strictness) + §10 (dependency hygiene) |
| Agent G | §8 (security audit) — Opus level, adversarial mandate |

Each agent produces a PR (worktree for §5; direct commit for others unless
multi-file). Curator/BT reviews before any merge. All PRs must pass `pnpm test`
and `pnpm lint`.

---

## Acceptance criteria (epic-level)

- [ ] `pnpm test` passes clean on main branch after all merges.
- [ ] `pnpm lint` passes clean.
- [ ] `pnpm audit` reports no high/critical vulnerabilities.
- [ ] No unintentional silent error swallowing in hot paths.
- [ ] `_retired/edit_message_text.ts` removed from registry.
- [ ] `buildKeyboardRows()` validates Telegram limits.
- [ ] `built-in-commands.ts` split into subdirectory structure.
- [ ] `spawn-child` capability R8 test gap closed.
- [ ] No inline comments describing behavior that no longer exists.
- [ ] No `console.*` in hot paths.
- [ ] Security audit findings document produced (`notes/2026-06-13-v8-security-audit.md`).
- [ ] All Critical and High security findings resolved or triaged with documented rationale.


---
> ⚠️ **AUDIT 2026-06-26:** Several line-items shipped (dead-code _retired/ removed in v7.8.0; test-hygiene overlaps the now-done 10-3020 sub-tasks) — tick those off. Remaining workstreams still valid. Minor: duplicate '### 9' heading to dedupe.
