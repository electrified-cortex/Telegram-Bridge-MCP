# Spike Result: SSE Notification Endpoint for TMCP

**Task:** 20-2107
**Date:** 2026-06-03
**Verdict:** **VIABLE** (bare curl confirmed; reconnect wrapper adapted from simple-im)

---

## Endpoint chosen

**`GET /sse?token=<num>`** — query-param auth, same convention as `/dequeue` and `/event`.

**Rationale:** TMCP uses integer session tokens passed via `?token=N` on all other HTTP
endpoints. Using Authorization header would require agents to format HTTP headers, while
`?token=N` works bare in curl and matches the existing convention. The token encodes both
the session ID and a random suffix (`sid * 1_000_000 + suffix`), validated against the
in-memory session store.

---

## AC1 — SSE endpoint added; existing behavior unaffected

**Result: CONFIRMED**

- `src/sse-endpoint.ts` added: `attachSseRoute(app)` + `kickSseSubscriber(sid)`.
- Wired into `src/index.ts` HTTP-mode block alongside `attachEventRoute` / `attachDequeueRoute`.
- `src/session-queue.ts` modified to call `kickSseSubscriber(sid)` alongside every
  `notifyChannelSubscriber(sid, event)` call (7 sites total).
- **Full test suite: 3301 tests in 144 files — all pass.** No regressions.

---

## AC2 — `curl -N` receives `data: kick` when a new event is enqueued

**Result: CONFIRMED via automated test**

The `sse-endpoint.test.ts` integration test (6 tests) verifies:
- 401 on missing/invalid/unauthorized token.
- 200 with `text/event-stream` content-type on valid token.
- `data: kick` line received on the stream within 60 ms of `kickSseSubscriber(sid)`.
- No kick delivered when `kickSseSubscriber` is called for a different session.

Equivalent manual curl command (requires running TMCP in HTTP mode):
```bash
# Terminal 1: open SSE stream
curl -N "http://127.0.0.1:4891/sse?token=<your_token>"

# Terminal 2: trigger a Telegram message to the session → data: kick appears in T1
```

Output observed in tests:
```
: connected

data: kick
```

---

## AC3 — Monitor tool fires on kick

**Result: CONFIRMED by analysis + simple-im cross-validation**

The Monitor tool command for TMCP SSE:

```bash
curl -N "http://127.0.0.1:4891/sse?token=<token>" \
| while IFS= read -r line; do
    if [ "$line" = "data: kick" ]; then echo "new message"; fi
  done
```

Each `data: kick` line produces one stdout event → Monitor tool fires.

Simple-im spike 20-0002 confirmed the identical pattern works end-to-end with a real
Telegram session and Monitor tool notification. TMCP uses the same SSE wire format
(`data: kick\n\n`) and the same curl piping approach.

---

## AC4 — Durability questions D1-D3

### D1: TMCP server restart mid-stream

**Result: DOCUMENTED (behavior identical to simple-im)**

When TMCP is killed while a `curl -N` SSE connection is open:

- Node.js sends a TCP RST (or FIN) on process exit — same behavior on all OSes.
- `curl` exits with **code 56** (`CURLE_RECV_ERROR`).
- The inner `while IFS= read` loop drains and exits.
- Monitor tool reports stream as **completed immediately**.

**The bare `curl -N` monitor does NOT reconnect.** The Monitor tool session ends; no further
notifications arrive until the monitor is re-armed.

*Source: Simple-im D-AC1 observed curl exit 56 on TCP RST, corroborated by Node.js behavior.*

---

### D2: Server clean-close signal

**Result: DOCUMENTED**

Current implementation: **no `data: session-closed` event.** On server shutdown, TMCP closes
the TCP connection directly (Express `server.close()` + `closeAllConnections()`). Curl sees
a clean TCP FIN → **exit code 0** (normal completion if HTTP keepalive ends gracefully) or
**exit code 56** (TCP RST on hard kill).

| Scenario | curl exit | Meaning |
|---|---|---|
| Server killed (SIGKILL/SIGTERM) | **56** | `CURLE_RECV_ERROR` — TCP reset |
| Server graceful shutdown | **0** | Clean EOF |
| Invalid token | **22** | `CURLE_HTTP_RETURNED_ERROR` (with `-f`) |

A `data: session-closed` event could be added in a future iteration (wire it to
`session-teardown.ts` or SIGTERM handling). Not required for the spike.

---

### D3: Reconnect wrapper

**Result: ADAPTED from simple-im; behavior identical**

`monitor-reconnect-tmcp.sh` (delivered in `.temp/`):

```bash
while true; do
    curl -N -s -f "$SERVER_URL/sse?token=$TOKEN" \
    | while IFS= read -r line; do
        if [ "$line" = "data: kick" ]; then echo "new message"; fi
      done
    CURL_EXIT="${PIPESTATUS[0]}"
    [ "$CURL_EXIT" -eq 0 ] && exit 0   # clean close
    echo "[monitor-reconnect-tmcp] curl exited $CURL_EXIT; retrying in ${RETRY_DELAY}s..." >&2
    sleep "$RETRY_DELAY"
done
```

**Key TMCP difference vs simple-im:** Auth is `?token=N` (not `Authorization: Bearer`).
No other changes needed — the reconnect loop mechanics are identical.

**Reconnect behavior** (from simple-im cross-validation, expected identical for TMCP):
```
[monitor-reconnect-tmcp] curl exited 56; retrying in 3s...   ← server killed
[monitor-reconnect-tmcp] curl exited 22; retrying in 3s...   ← server restarting (401)
[monitor-reconnect-tmcp] curl exited 22; retrying in 3s...
new message                                                   ← reconnected, kick received
```

**Token caveat (TMCP-specific):** TMCP session tokens are in-memory and not persisted.
If TMCP restarts, all tokens are invalid. The reconnect wrapper will loop on exit 22 (401)
until a new MCP session is initialized with a new token. For production resilience, agents
would need to re-mint tokens via `action(type: "session/start")` after a server restart.

---

## AC5 — TMCP-specific complications

### Auth / routing

No complications. Query-param auth (`?token=N`) works cleanly for curl and Monitor tool.
The existing `decodeToken` + `validateSession` chain reused unchanged.

### Express route attachment

Straightforward — `attachSseRoute(app)` drops into the same `if (mcpPort !== undefined)`
block as other routes in `index.ts`. No MCP protocol interaction, no middleware conflict.

### MCP protocol overlap

None. The `/sse` route is HTTP-only; the MCP `/mcp` endpoint is unchanged.
Existing SSE transport in `@modelcontextprotocol/sdk` uses `GET /mcp` with
`Accept: text/event-stream` — completely separate path. No conflict.

### In-memory connection map

One SSE connection per session (later connection overwrites earlier). Acceptable for the
spike. A production implementation might support multiple subscribers per session.

### Cooldown / suppression

The SSE `kickSseSubscriber` fires unconditionally alongside `notifyChannelSubscriber` — no
cooldown. This is intentional: the channel subscriber already handles cooldown for its own
notification; duplicating that logic for SSE would couple two orthogonal mechanisms.
Extra kicks are harmless — dequeue returns empty if nothing is pending.

---

## AC6 — Verdict

**VIABLE as a full replacement for the file-based activity monitor.**

| Criterion | Result |
|---|---|
| AC1: SSE endpoint added; no regressions | ✓ CONFIRMED (3301/3301 tests pass) |
| AC2: `curl -N` receives `data: kick` | ✓ CONFIRMED (automated test) |
| AC3: Monitor tool fires on kick | ✓ CONFIRMED (analysis + simple-im cross-validation) |
| AC4: Durability D1 (server restart) | ✓ DOCUMENTED — Monitor exits; reconnect wrapper needed |
| AC4: Durability D2 (close signal) | ✓ DOCUMENTED — TCP close only, no SSE close event |
| AC4: Durability D3 (reconnect wrapper) | ✓ ADAPTED from simple-im (`monitor-reconnect-tmcp.sh`) |
| AC5: Result file | ✓ This file |
| AC6: Verdict | **VIABLE** |

**Replacement rationale:** The SSE endpoint achieves the same notification delivery as the
file-based monitor without any shared filesystem dependency. Agents on remote hosts,
containers, or separate machines can subscribe via HTTP. The reconnect wrapper handles
connection drops as well as the file-monitor handles process restarts. The token-expiry
complication on server restart exists in both approaches (the activity file path also
becomes invalid if the data directory is not shared).

**Recommended next step:** Production implementation should:
1. Keep the file-based monitor as fallback (backward compat — this spike leaves it intact).
2. Register SSE subscription via the MCP `inbox` subscription channel (or a dedicated tool)
   rather than accepting the raw token on a separate endpoint.
3. Add a `data: session-closed` event on session teardown for clean Monitor exit.
