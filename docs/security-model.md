# Security Model

This document explains the security boundary for Telegram Bridge MCP, what is protected, what is not, and how to operate it safely. It is intentionally explicit about risk because this project exists to unlock agent capability.

---

## Executive Summary

- This server protects the Telegram boundary (who can talk to the bot, and which chat the bot can act in).
- This server does NOT protect your host environment (filesystem, shell, network, secrets) if your MCP host grants those tools to the agent.
- If you bind this server to an untrusted or unbounded agent, you can still lose data or secrets through other MCP tools.

---

## Primary Security Boundary

Telegram Bridge MCP enforces a strict, single-user / single-chat model by default:

- `ALLOWED_USER_ID` blocks inbound updates from anyone else, and its value is used as the outbound chat target (for private bots, chat.id === user.id).

This prevents message injection from unknown Telegram users and prevents misdirected sends.

---

## User Privacy & PII

The operator's personal information (real name, Telegram username, chat description) is **not** exposed to the agent by default. Tools that could leak PII without user consent apply the following controls:

| Tool | PII risk | Control |
| --- | --- | --- |
| `get_chat` | Returns username, first/last name, description for DM chats | Consent gate: agent must request, user must approve via Telegram button before PII is returned |
| `dump_session_record` | Dumps full conversation history including voice transcripts, file metadata, locations, and contacts | Description explicitly restricts use to user-requested history dumps; must not be called speculatively |
| `get_message` | Allows lookup of any stored message by ID | Description restricts calls to message IDs already known to the agent session |
| `update-sanitizer` (reaction events) | Raw Telegram reactions include reactor name and username | Name and username are stripped; only the numeric user ID is forwarded |

**Agent guidance:** Tools in the `Agent Guide` (`behavior.md`) instruct agents not to call identity-exposing tools without explicit operator request.

---

## What This Server DOES Protect

- Inbound message authenticity within Telegram (only the configured user is accepted).
- Outbound message targeting (chat target derived from `ALLOWED_USER_ID` — no `chat_id` parameter to misuse).
- Telegram API errors are surfaced as structured errors with clear remediation.
- User PII is not exposed to agents without explicit operator consent (see User Privacy table above).

---

## What This Server DOES NOT Protect

These risks are outside this server and must be handled by your MCP host and agent policies:

- Filesystem access (read, write, delete) if the agent can run shell tools or file tools.
- System access (process execution, package installs, environment secrets).
- Network access beyond Telegram (curl, HTTP clients, arbitrary endpoints).
- Data exfiltration through other MCP tools (e.g., reading local files and sending them elsewhere).

If your MCP host provides any of those capabilities to the agent, the safety boundary is no longer the Telegram bot. It is the host policy.

---

## Operational Guidance (Recommended)

Use these controls at the MCP host level when you care about safety:

- Do not grant shell or filesystem tools to untrusted or unbound agents.
- Use allow-lists for tools and directories.
- Require explicit user confirmation for destructive actions (delete, overwrite, network sends).
- Run the agent in a sandboxed account or container when possible.
- Keep `ALLOWED_USER_ID` set at all times.

---

## File Handling Risk

This server can send and receive files (local path or URL). That is a capability, not a sandbox:

- Local paths can expose secrets if an agent is allowed to read them.
- URL fetches can be used to access internal resources if the host network allows it.

Treat file tools as privileged operations and gate them accordingly in your MCP host.

---

## Threat Model Summary

| Threat | Mitigated Here | Mitigation |
| --- | --- | --- |
| Stranger messages the bot | Yes | `ALLOWED_USER_ID` filter |
| Agent sends to wrong chat | Yes | No `chat_id` parameter — target derived from `ALLOWED_USER_ID` |
| Destructive local actions | No | Host-level tool policy |
| Secret exfiltration | No | Host-level tool policy |
| Arbitrary network access | No | Host-level tool policy |
| Agent behavior guide tampered | No | See supply chain note below |

---

## Supply Chain / Behavior Guide Integrity

`get_agent_guide` serves the contents of `behavior.md` directly into the agent's context on every session start. If `behavior.md` is modified (e.g., by a compromised dependency, CI step, or local access), an attacker could inject instructions into every agent session without the user noticing any change in tool output.

Mitigations:

- Keep the repository under version control and review `behavior.md` in code review.
- Sign or checksum `behavior.md` in security-critical deployments.
- Treat `behavior.md` modifications as security-relevant changes.

---

## Recommended Disclosure (Short Form)

This project secures the Telegram boundary, not your host. If your MCP host grants the agent shell, filesystem, or network tools, those risks are outside this server. Use host-level allow-lists, confirmations, or sandboxing when needed.
