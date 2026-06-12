---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-449
Source: Operator directive — approval request expired before Curator could process it
---

# Double approve_agent timeout

## Background

Worker 2 respawn triggered a `pending_approval` event, but the approval request
expired before the Curator could process it through the message queue. The
Curator was processing a backlog of messages when the approval arrived, and by
the time it reached the approve action, the request had timed out.

## Objective

Double the default timeout for `approve_agent` pending requests so agents have
sufficient time to process approval requests even when their message queue has
depth.

## Acceptance Criteria

- [ ] Default approval timeout doubled from current value
- [ ] Timeout applies to the pending_approval wait period (how long the bridge
      holds the request before expiring)
- [ ] Verify: approval request survives at least 60 seconds of queue latency

## Reversal

Revert the timeout constant to its previous value.
