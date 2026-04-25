# Compact Mode Migration Guide

`response_format: "compact"` is a new optional parameter that reduces per-call response
size by suppressing fields whose values can be reliably inferred. Estimated savings:
**~445 tokens per session**.

---

## What changed

Six tools now accept an optional `response_format` parameter:

| Tool | Accepted values |
| --- | --- |
| `dequeue` | `"default"` (default) \| `"compact"` |
| `send` (text / audio) | `"default"` (default) \| `"compact"` |
| `ask` | `"default"` (default) \| `"compact"` |
| `choose` | `"default"` (default) \| `"compact"` |
| `confirm` | `"default"` (default) \| `"compact"` |
| `send_new_checklist` (update path) | `"default"` (default) \| `"compact"` |

Omitting the parameter or passing `"default"` preserves the existing response shape
exactly — no existing callers are affected.

---

## Field suppression table

| Tool | Field suppressed in compact | How to infer |
| --- | --- | --- |
| `dequeue` | `empty: true` | Absence of `updates` key → empty poll |
| `dequeue` | *(no suppression of `timed_out: true`)* | `timed_out: true` is **always** emitted |
| `send` (multi-chunk) | `split: true` | `message_ids.length > 1` |
| `send` (multi-chunk) | `split_count` | `message_ids.length` |
| `ask` | `timed_out: false` | Presence of response fields → not timed out |
| `ask` | `voice: true` | *(omitted; check `voice` explicitly if needed)* |
| `choose` | `timed_out: false` | Presence of response fields → not timed out |
| `confirm` | `timed_out: false` | Presence of response fields → not timed out |
| `send_new_checklist` (update) | `updated: true` | Success response on update path → was updated |

---

## Dequeue loop: before / after

### Default mode (no change required)

```js
const result = await dequeue();

if (result.empty) {
  // queue empty — drain complete
} else if (result.timed_out) {
  // 300 s elapsed with no message — check in, then loop
} else {
  // process result.updates
}
```

### Compact mode

```js
const result = await dequeue({ response_format: "compact" });

if (!result.updates) {
  // empty — absence of updates key means empty poll
} else if (result.timed_out) {
  // timeout — timed_out: true is always emitted in compact mode
} else {
  // process result.updates
}
```

The key difference: check for the **absence of `updates`** rather than the **presence of
`empty`**. The timeout branch is unchanged — `timed_out: true` is never suppressed.

---

## Rollout guidance

- `response_format` is **per-call** — no global setting. Opt in one tool call at a time.
- **Migrate each agent independently.** There is no coordination requirement between agents.
- **Suggested order:**
  1. Add `response_format: "compact"` to your `dequeue` drain poll (`max_wait: 0`) calls first.
  2. Update the blocking `dequeue()` call loop body to check `!result.updates` for empty.
  3. Optionally add `response_format: "compact"` to `ask`/`choose`/`confirm` calls once the
     dequeue loop is stable.
- **No rollback risk.** Removing the parameter at any time reverts to `"default"` behaviour.
