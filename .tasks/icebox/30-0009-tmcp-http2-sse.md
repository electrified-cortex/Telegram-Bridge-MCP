---
created: 2026-06-12
status: icebox
priority: 30
source: harness-task-11
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# 30-0009 — Investigate HTTP/2 for TMCP SSE transport

## Context

TMCP currently uses HTTP/1.1 for its SSE monitor connections. HTTP/2 multiplexing could reduce per-connection overhead and improve reliability of long-lived SSE streams. This is a future investigation item with no committed timeline.

## Objective

Evaluate HTTP/2 feasibility for the TMCP SSE transport: identify library support, measure connection overhead reduction, and produce a short findings note. Do not implement; produce a recommendation.

## Acceptance Criteria

1. Findings note identifies whether the current Node.js HTTP server supports HTTP/2 upgrade without a rewrite.
2. Note quantifies expected overhead reduction (or states it is unmeasurable without profiling).
3. Note recommends proceed, defer, or reject with rationale.
4. No production code is changed by this task.

## Scope boundary

- Research and recommendation only; no implementation.
- Does not cover WebSocket or gRPC alternatives.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 30 — icebox-candidate
