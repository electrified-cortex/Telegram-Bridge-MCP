# Research: Telegram "Online Green Dot" Presence for Bot/Sessions

**Date:** 2026-04-19
**Task:** 30-718
**Status:** Complete — verdict delivered

---

## Summary

Showing a Telegram "online" green dot is **not feasible via the Bot API**. It is **partially feasible via MTProto** (user-account path), with a Node.js/TypeScript library available — but requires operating a separate user account, which carries ToS risk.

---

## Verdict

| Path | Feasibility |
|---|---|
| Bot API | Not feasible — no presence methods exist |
| MTProto (user account) | Partially feasible — Node.js library available, ToS risk applies |

---

## Findings

### 1. Bot API — No Capability

The Telegram Bot API exposes no method to signal online status. There is no `setPresence`, `updateStatus`, or equivalent. Bot accounts are architecturally distinct from user accounts:

- Bots always appear without a last-seen indicator — clients render them as "bot," not with a green dot.
- `UserStatus` objects (`UserStatusOnline`, `UserStatusOffline`, etc.) exist in MTProto but are **not exposed through the Bot API**.
- No Bot API method touches presence state.

### 2. MTProto Path — `account.updateStatus`

MTProto exposes `account.updateStatus(offline: bool)`, the mechanism Telegram user clients use to set the green dot.

**Critical constraint:** This is a **user-account API call only**. To use it, the account must be authorized as a user (phone + OTP or session string), not as a bot token. A `@BotFather`-registered bot token cannot call `account.updateStatus` — the two account types are mutually exclusive.

**Node.js/TypeScript library:** [GramJS](https://github.com/gram-js/gramjs) (`telegram` npm package) is a full MTProto client for Node.js/TypeScript. It supports user-account authorization and exposes the full MTProto method surface including `account.updateStatus`. Python is **not required** — GramJS is a viable path.

```ts
// GramJS example (TypeScript)
await client.invoke(new Api.account.UpdateStatus({ offline: false }));
```

### 3. Per-Session vs. Global

Telegram presence is **account-scoped, not session-scoped**. A single `account.updateStatus(offline: false)` call from any active session marks the account online globally. One heartbeat from any Worker/Curator session is sufficient — there is no need to heartbeat from every session.

### 4. Heartbeat Cadence & Rate Limits

- Telegram clients heartbeat approximately every **4–5 minutes** while active.
- Online status expires server-side after roughly **4–5 minutes** of no heartbeat, after which the account transitions to "recently online."
- To keep the green dot continuously lit: heartbeat interval of **~180–240 seconds** (3–4 minutes).
- `account.updateStatus` rate limits are lenient — the call is designed for frequent invocation. No documented flood-wait applies at normal cadence.

**MCP integration sketch (if pursued):** A recurring reminder or background task calling `account.updateStatus` every 3 minutes via a GramJS sidecar process. This is outside current TMCP architecture — TMCP uses a bot token, not a user session.

### 5. Prior Art

- **Userbots** (user accounts operated programmatically via GramJS/Telethon/Pyrogram) routinely show green dots — this is the entire foundation of userbot frameworks.
- `@BotFather` and all `@BotFather`-registered bots show **no last-seen or online indicator**.
- "Bots" that appear online are actually **userbots** — user accounts, not registered bots.
- No known exception exists for bot accounts to show online status.

### 6. ToS / Account Type Implications

This is the most significant constraint:

- **Telegram ToS** prohibits using user accounts for automated/bot behavior (section 8.3 and related). Running a userbot for automated responses is a ToS gray area and can result in account termination.
- A `@BotFather` bot token **cannot** be used with `account.updateStatus` — there is no hybrid mode.
- If implemented, it would require a **separate user account** acting as a userbot companion to the existing bot. This account would need to be operated under the user-account session model.
- Telegram enforcement is more lenient for low-volume personal userbots; stricter for commercial/spam-scale operations.

---

## Open Questions — Answered

**Q: If multiple sessions are active, does one heartbeat suffice?**
A: Yes — presence is per-account. One session heartbeating is sufficient.

**Q: Does the user-account/MTProto path make the bot a "user" account?**
A: Yes, effectively. It requires a separate user account (phone-registered), distinct from the `@BotFather` bot. This user account would be operated programmatically — which is the definition of a userbot.

---

## Recommendation

**Do not implement** in this task cycle. The path requires:

1. A separate Telegram user account (phone number, OTP flow, ToS exposure).
2. A GramJS sidecar with user-session credentials alongside the existing bot token.
3. Ongoing heartbeat at 3-minute intervals — a new always-on process concern.

The UX value (green dot at-a-glance signal) is low relative to the stack complexity and ToS risk added. The existing typing indicator and dequeue-driven activity provide functional equivalents for "is an agent paying attention."

If the operator wants to revisit: a GramJS sidecar is the technically viable path, ToS risk acknowledged, with no Python requirement.

---

## Related

- [Telegram Bot API](https://core.telegram.org/bots/api) — no presence methods
- [MTProto account.updateStatus](https://core.telegram.org/method/account.updateStatus) — user accounts only
- [GramJS](https://github.com/gram-js/gramjs) — Node.js/TypeScript MTProto client
- Task 30-718 (this task)
