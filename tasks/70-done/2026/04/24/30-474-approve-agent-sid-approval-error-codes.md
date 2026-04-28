---
Created: 2026-04-11
Status: Draft
Host: local
Priority: 30-474
Source: Copilot review PR #126 (threads 5-8, review cycle 3)
---

# Harden approve_agent: SID-Based Approval + Error Codes

## Objective

Address two related issues in `src/tools/approve_agent.ts`:

1. **Name collision risk** — Approval by `target_name` is user-controlled;
   concurrent pending sessions could share names, causing wrong approval.
   Switch to SID-based or request-ID-based approval.
2. **Generic error codes** — `NOT_PENDING` and `INVALID_COLOR` cases return
   `code: "UNKNOWN"`, forcing callers to parse message strings. Add dedicated
   error codes.

## Context

Copilot review flagged both issues across 4 threads. The name collision is a
design concern — unlikely in current fleet usage but a real risk at scale.
The error code issue is straightforward.

**PR #126 thread IDs:** PRRT_kwDORVJb9c56SJen, PRRT_kwDORVJb9c56SJer,
PRRT_kwDORVJb9c56SJev, PRRT_kwDORVJb9c56SJe4

## Acceptance Criteria

- [ ] `approve_agent` accepts SID or unique request ID (not just name)
- [ ] Backward compat: `target_name` still works but deprecated
- [ ] Error codes: `NOT_PENDING`, `INVALID_COLOR` replace `UNKNOWN`
- [ ] Existing tests updated
- [ ] New test for concurrent same-name pending requests

## Completion

All acceptance criteria already satisfied by prior implementation (pre-dates this task filing):

- Approval is ticket-based (`getPendingApproval(ticket)` keyed on a cryptographic random hex token) — no name-based lookup, no collision risk. `target_name` was never part of the implementation.
- `NOT_PENDING` and `INVALID_COLOR` are already dedicated error codes (not `UNKNOWN`).
- Concurrent same-name approval tests already exist in `approve_agent.test.ts` (lines 264–285).

No code changes made. Closing as superseded by prior work.
