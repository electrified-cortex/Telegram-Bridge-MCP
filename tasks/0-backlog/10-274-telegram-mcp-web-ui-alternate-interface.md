---
Created: 2026-04-04
Status: Draft
Priority: 10
Source: Operator direction (2026-04-04 session) — replaces 20-225
Type: Epic / Minor or Major Version Feature
Repo: electricessence/Telegram-Bridge-MCP
---

# 10-274: Telegram Bridge MCP — Web UI Alternate Interface

## Concept

Add a browser-based interface to the Telegram Bridge MCP as a first-class alternative
to the Telegram front end. The MCP bridge already handles all session logic, DMs,
reminders, and tool routing internally — Telegram is just one interface into it. A local
web UI would expose the same interaction surface without requiring a Telegram account,
bot token, or internet connection.

## Motivation

- **Onboarding friction:** The PIN/pairing step requires Telegram to receive the code.
  A web UI could present the pair link directly in the browser — click to approve.
- **Telegram unavailable:** Bot ban, token compromise, platform outage, or no internet.
  Agents stay in their loop; operator gets a local browser tab instead.
- **Offline operation:** Fully local deployment with no external dependencies.
- **Alternative preference:** Some users may prefer a web UI over a Telegram bot.

## Proposed Feature Set (V1)

1. **Local web server** — the MCP bridge serves a minimal web UI on a configurable port
   (e.g., `localhost:3100`) when started with a flag (e.g., `--web-ui`).

2. **Pairing integration** — during `session_start`, if no Telegram bot is configured,
   the bridge prints a URL: `Open http://localhost:3100 to approve this session`.
   Browser opens to an approval page that replaces the Telegram PIN flow.

3. **Message feed** — the web UI shows the same message stream the Telegram chat would:
   text messages, voice transcripts, inline keyboards (rendered as HTML buttons),
   animations replaced by text status indicators.

4. **Operator input** — text box for sending messages, button clicks work as callback
   data, same as Telegram inline keyboard presses.

5. **No-bot mode** — bridge starts without `BOT_TOKEN` env var. All agent-to-agent
   features (DMs, reminders, routing) work. Operator interaction routes through the
   web UI instead of Telegram.

## Scope Boundaries

- V1 is local only — no hosted/cloud UI
- No real-time voice recording in V1 (voice notes displayed as text transcripts)
- Telegram and Web UI are mutually exclusive per session (not simultaneous)

## Acceptance Criteria

- [ ] Bridge starts in no-bot mode (no BOT_TOKEN) without crashing
- [ ] `--web-ui` flag serves a local HTTP interface
- [ ] Session approval (PIN/pairing) works via browser when no Telegram bot configured
- [ ] Text messages and inline keyboards render and respond correctly in browser
- [ ] DMs between agents still work in no-bot mode (bridge-internal routing)
- [ ] Reminders still fire in no-bot mode
- [ ] README documents the web UI mode with setup instructions

## Notes

- This is a minor or major version bump (new interface mode)
- Curator to refine spec before queuing — architecture decision needed on web framework
  (minimal Node HTTP vs. something like Hono or Express)
- Related: 20-224 (telegram data exposure policy — may have implications for web UI auth)
