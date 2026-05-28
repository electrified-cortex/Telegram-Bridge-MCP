# telegram-mcp-dump-handling spec

## Purpose

Define the procedure for handling Telegram session dumps — structured JSON conversation captures the bridge produces on demand. Dumps must be filed promptly so no conversation history is lost between sessions or compactions.

This skill exists because dumps are not auto-archived by the bridge; the receiving agent is responsible for capturing the document, filing it to a deterministic location, and acknowledging the operator. Without this skill, dumps end up as floating chat artifacts.

## Scope

Applies when:

- An `action(type: "log/dump")` document arrives in the chat as a `document` event.
- Periodic maintenance scans for unfiled dumps in the chat history.

Does NOT cover:

- The bridge's own NDJSON log files (those auto-rotate and live separately).
- Memory artifact filing (separate skill / agent responsibility).
- Operator-initiated history exports outside the dump action.

## Requirements

R1. The skill MUST present the two-step reaction protocol:
   1. `✍` (pencil) when processing begins.
   2. `🫡` (salute) when fully filed (replaces `✍`).

R2. The skill MUST cover inline (reactive) filing: dump appears in `dequeue` → react `✍` → download → save to canonical path → react `🫡` → continue loop.

R3. The skill MUST cover periodic-scan filing: scan chat history for unfiled dump documents (those without `🫡` reaction), file each with the same protocol.

R4. The skill MUST require commit if the file landing path is git-tracked. Local-only filing is permissible if the host explicitly opts out of versioning.

R5. The skill MUST instruct on download tooling: `action(type: "download", file_id: <id>)` returns the bytes; agent writes to the deterministic path.

## Constraints

C1. Filing path is host-determined — the skill states the convention abstractly (per-date subfolder, dated filename) without baking absolute paths or workspace-specific prefixes.

C2. Runtime card under ~100 lines. Filing is mechanical; verbosity adds no value.

C3. Two-step reaction protocol is the only sanctioned ack pattern; do not introduce alternates.

## Don'ts

DN1. Do NOT instruct agents to read or summarize dump contents. They are archives, not data the agent processes.
DN2. Do NOT bake workspace path conventions (`logs/telegram/YYYYMM/DD/HHmmss/`) into the skill. The convention is the pattern, not the literal path.
DN3. Do NOT skip the reaction steps even if filing succeeds silently. Operator visibility into "this dump was caught and filed" depends on the reactions.
