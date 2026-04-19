profile/dequeue-default — Set per-session default dequeue timeout.

Once set, all dequeue calls from this token use this default when timeout is not explicitly passed.
Priority: explicit timeout param > session default > server default (300s).
Session-lifetime only — cleared when session closes.

## Params
token: session token (required)
timeout: default timeout in seconds (required; 0–3600; 0 = instant poll mode)

## Examples
Persistent agent (long wait):
action(type: "profile/dequeue-default", token: 3165424, timeout: 600)
→ { ok: true, timeout: 600, previous: null }

VS Code extension (just under 5-min cache window):
action(type: "profile/dequeue-default", token: 3165424, timeout: 290)

Instant poll mode:
action(type: "profile/dequeue-default", token: 3165424, timeout: 0)

## Typical values
| Role                | Value | Rationale             |
| Persistent agent    | 600   | Long-wait dequeue loop |
| VS Code extension   | 290   | Stay under cache window |
| One-shot runner     | 300   | Server default is fine  |

Related: profile/load, profile/save