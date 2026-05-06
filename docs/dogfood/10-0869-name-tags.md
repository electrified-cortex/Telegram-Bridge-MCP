# Dogfood Walkthrough: Custom Name Tags (10-0869)

Verifies ACs 5, 6, 7 via live Curator session.

---

## Steps

### 1. Start session (AC7)

Start Curator session. Auto-default tag assigned: `<color-emoji> Curator`.

```json
action(type: "session/start", name: "Curator")
// response: { token: <T>, ... }
```

---

### 2. Set custom tag (AC5)

```json
action(type: "name-tag/set", name_tag: "🟢 Curator", token: <T>)
// response: { ok: true, name_tag: "🟢 Curator" }
```

---

### 3. Verify outbound (AC5)

Send any message. Confirm prefix renders as `` `🟢 Curator` `` (monospace-wrapped).

```json
send(text: "test", token: <T>)
// message visible in chat: `🟢 Curator` test
```

---

### 4. Get current tag (AC5)

```json
action(type: "name-tag", token: <T>)
// response: { name_tag: "🟢 Curator" }
```

---

### 5. Save profile (AC6)

Profile includes `name_tag` field when custom tag differs from auto-default.

```json
action(type: "profile/save", key: "Curator", token: <T>)
// profile JSON: { ..., "name_tag": "🟢 Curator", ... }
```

---

### 6. Close session

```json
action(type: "session/close", token: <T>)
```

---

### 7. Restart and reload (AC7)

```json
action(type: "session/start", name: "Curator")
// response: { token: <T2>, ... }

action(type: "profile/load", key: "Curator", token: <T2>)
// response: { ok: true, ... }
```

---

### 8. Verify reload (AC6, AC7)

```json
action(type: "name-tag", token: <T2>)
// response: { name_tag: "🟢 Curator" }
```

Custom tag persisted through close/restart cycle.

---

### 9. Verify outbound after reload (AC5, AC7)

Send any message. Prefix still renders as `` `🟢 Curator` ``.

---

## Negative case — no custom tag set

If session never called `name-tag/set` and profile is saved:

- Profile JSON does **not** contain `name_tag` field.
- On next load, session uses auto-default tag (`<color-emoji> Curator`).
- No stale custom tag bleeds in from a prior session.
