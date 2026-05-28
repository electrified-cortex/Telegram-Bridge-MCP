# telegram-mcp-dump-handling — uncompressed

## What this skill governs

The procedure for receiving and filing Telegram session dump documents. Dumps are structured JSON conversation captures produced on demand by `action(type: "log/dump")`. The bridge does not auto-archive them — the receiving agent is responsible for capture, filing, and acknowledgment.

Not covered: bridge NDJSON log rotation (auto-managed separately), memory artifact filing (separate responsibility), operator-initiated exports outside the dump action.

## Two-step reaction protocol

Every dump filing uses this two-step reaction sequence on the dump message. No alternates.

```text
1. React ✍ (pencil) — immediately when processing begins.
2. React 🫡 (salute) — when fully filed (replaces ✍).
```

The reactions are not optional. The operator's only visibility into "this dump was caught and filed" is the reaction sequence.

## Inline (reactive) filing

Triggered when a `document` event arrives in `dequeue`:

```text
1. React ✍ on the dump message.
2. action(type: "download", file_id: <id>) — returns document bytes.
3. Write bytes to the canonical path (host-determined — see path convention below).
4. If the path is git-tracked: stage and commit.
5. React 🫡 (replaces ✍).
6. Continue the dequeue loop.
```

## Periodic (proactive) filing

On a recurring maintenance scan:

```text
1. Scan chat history for dump documents missing the 🫡 reaction.
2. For each unfiled dump:
   a. React ✍.
   b. action(type: "download", file_id: <id>).
   c. Write to canonical path.
   d. If git-tracked: stage.
   e. React 🫡.
3. If any files were staged: commit all in a single commit.
```

This catches dumps that arrived while the agent was compacted, force-stopped, or otherwise unavailable.

## Path convention

Host-determined. The skill requires:
- A per-date subfolder structure.
- A dated filename derived from the dump's creation timestamp (not the current time).

Example structure: `<logs-root>/<YYYYMM>/<DD>/<HHmmss>/dump.json`. The literal path is established by the host deployment — do not bake specific absolute paths here.

## Download tooling

```text
action(type: "download", file_id: <id>)
```

Returns the bytes of the document. Write those bytes to the canonical path using the memory/file tools available to the agent.

## Commit requirement

If the landing path is under git version control, the agent MUST commit after filing. Local-only filing is permissible if the host has explicitly opted out of versioning.

## Don'ts

- Do not read or summarize dump contents. Dumps are archives, not data to process.
- Do not bake specific absolute paths or workspace-specific prefixes into this skill.
- Do not skip the reaction steps even if filing succeeds silently.
