---
title: Audit session.test.ts — content-checking footgun
source: operator (TG 77755), queued 2026-06-21
priority: medium
status: idea
type: maintenance + refactor
---

## Problem

`session.test.ts` contains tests that assert on literal instructional content — e.g., checking that a service message body includes strings like:

> "Save token to memory/telegram/session.token first, then call dequeue(token) NOW — do not proceed without draining"

This is a maintenance nightmare: the test is coupled to the exact wording of a service message, meaning any copy-edit to that message silently breaks tests, and vice versa — the test content risks leaking into agent context and being interpreted as instructions.

Operator noted: "If the agent calls dequeue(token) don't we use a service message to tell them to save their token? ... It's a footgun."

## Scope

1. Locate all content-checking assertions in `session.test.ts` (and any other test files) that assert on literal human-readable service message strings.
2. Evaluate whether each assertion should:
   - Test **structure** (event_type, origin field, presence of token field) instead of exact text
   - Be removed if the content is not contractually meaningful
   - Be replaced with a snapshot test with explicit opt-in update path
3. Propose refactored assertions that are decoupled from copy.
4. Ensure tests still catch regressions in message delivery, routing, and token presence — without coupling to wording.

## Deliverable

- Audit report: which tests check content, what they risk, proposed fix per test
- PR with refactored assertions

## Notes

- Do NOT remove meaningful behavioral tests — only decouple from literal copy.
- Keep token-presence checks (e.g., `token` field exists), remove wording checks.
