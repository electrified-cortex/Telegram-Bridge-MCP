---
title: session/spawn-child MUST require a non-blank topic (fail-fast)
filed: 2026-06-15
source: operator (Telegram msgs 75003–75016)
status: BUG / BACKLOG
relates: subsession topic immutability
---

## Bug
`session/spawn-child` currently accepts a spawn with **no `topic`** (or a blank/empty topic). The child is created with a default topic (the parent's name, e.g. "Curator"), producing **zero-topic threads**.

## Impact
The topic is set **at spawn time and is IMMUTABLE** thereafter — calling `profile/topic` on a child returns:
`CAPABILITY_DENIED: "Sub-sessions cannot change their topic — it was set at spawn time and is immutable."`
So a topic-less spawn is **unrecoverable**: the subsession can never get a proper topic; the only remedy is revoke + re-spawn. Operator: *"Sub-sessions (threads) MUST HAVE A TOPIC"* — zero-topic threads are a serious issue. Agents repeatedly omit the param and create orphan-topic threads.

## Expected
`session/spawn-child` should **REJECT/ERROR at spawn time** if `topic` is missing OR blank/empty. Fail fast — do not create the session. The error should name the required `topic` parameter.

## Operator quotes
- "spawning a child should require a topic. Fail at that moment."
- "Cannot be blank."
- "You don't rename a session, you just have a different topic." (rename is the wrong mechanism; topic is the distinguisher)

## Why it matters
The silent topic-less spawn + the immutability together make this a footgun that keeps producing untopic'd threads. Requiring the topic at spawn closes it permanently.
