# telegram-mcp-shutdown-protocol spec

## Purpose

Define the bridge-level shutdown handshake — the protocol agents follow when the bridge announces a planned or forced shutdown via dequeue. This is distinct from a single-agent graceful close: it is the bridge-to-fleet broadcast that the entire bridge process is going down.

This skill exists because the bridge cannot wait indefinitely for agents to finish; it announces a shutdown window and expects every connected agent to wipe its token, close its session, and exit the loop within the announced window.

## Scope

Applies when an agent receives a shutdown warning event in `dequeue`, including:

- Planned shutdown announced by the operator or governor.
- Forced shutdown initiated by `action(type: "shutdown", force: true)`.
- Bridge process restart events.

Does NOT cover:

- Per-agent graceful shutdown invoked by an operator stop directive (see `telegram-mcp-graceful-shutdown`).
- Stop hook handling (see `telegram-mcp-stop-hook-recovery`).
- Forced-stop recovery (see `telegram-mcp-forced-stop-recovery`).

## Requirements

R1. The skill MUST present the protocol as ordered steps:
   1. **Wipe token** — clear the session token from in-memory state and from the session memory file.
   2. **Close session** — `action(type: "session/close")`.
   3. **Exit loop** — stop dequeuing; end the agent's turn.

R2. The skill MUST state the rationale for token-wipe-first ordering: if the host's stop-hook or loop guard prevents the agent from terminating, an empty token file lets the loop guard recognize the session as inactive instead of blocking exit.

R3. The skill MUST cover both planned and forced shutdown variants:
   - Planned: countdown announced; agents have N seconds to wrap.
   - Forced: immediate; agents skip wrap-up steps and execute the protocol.

R4. The skill MUST instruct agents to NOT compose a final message to the operator during a forced shutdown — the bridge is going down anyway.

R5. The skill MUST cross-reference `telegram-mcp-graceful-shutdown` for the per-agent close call detail.

## Constraints

C1. Runtime card under ~80 lines. The protocol is short; verbosity defeats the purpose under shutdown pressure.

C2. The token-wipe step is non-optional even under forced shutdown — agents must wipe before close to satisfy the loop-guard contract.

C3. Use generic agent labels — no workspace-specific roles.

## Don'ts

DN1. Do NOT instruct agents to ignore a forced-shutdown warning to "finish current work." Forced means now.
DN2. Do NOT introduce a confirmation dialog — shutdown is one-way.
DN3. Do NOT bake workspace-anchored paths for token files; the convention is "session memory file" abstractly.
