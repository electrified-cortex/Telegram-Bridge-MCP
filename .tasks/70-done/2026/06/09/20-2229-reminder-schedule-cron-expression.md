---
id: 20-2229-reminder-schedule-cron-expression
title: "reminder/schedule — cron expression support for wall-clock reliable reminders"
Created: 2026-06-09
Status: draft
Priority: 20
type: feature
Source: operator voice 70528, 70588–70604 — 2026-06-09
---

# reminder/schedule — cron expression support

## Problem

`reminder/set` uses relative `delay_seconds` anchored to session start, not wall-clock
time — and it is **hard-capped at 86400s (24h)** (`set.ts:85`). A session that restarts at
2pm with a "daily at 1am" reminder fires at 2pm next day. CronCreate (Claude Code) only
fires when the REPL is idle — unreliable for active-polling agents. Pods need reliable
wall-clock-anchored scheduled events that survive restarts and reach agents that are parked
idle on an SSE monitor.

## Solution

Add `reminder/schedule` and `reminder/unschedule` actions that accept a standard 5-field
cron expression. TMCP computes the next wall-clock fire time and uses a **dual mechanism**:
the **in-dequeue-loop wall-clock check is the source of truth for firing** (deterministic,
drift-proof, self-healing across restarts), while a **one-shot timer serves only as a wake
signal** that kicks the SSE/monitor subscriber so an idle/parked agent dequeues and the
in-loop check fires it. See the CRITICAL section for the rationale.

---

## CRITICAL — verified architecture facts (read before implementing)

The existing reminder subsystem has **no `setTimeout`/`setInterval` anywhere**. All current
reminders fire by **polling inside the dequeue loop**:

- `promoteDeferred(sid)` — "Call this at the start of each dequeue iteration"
  (`reminder-state.ts:243`). Promotes deferred→active when `delay_seconds` elapsed.
- `popActiveReminders(sid)` — fires active reminders after 60s queue-idle, inside dequeue
  (`reminder-state.ts:260`, `dequeue.ts` idle check).
- `fireStartupReminders(sid)` — fires on `session_start` (`reminder-state.ts:301`).

**Design decision (operator voice 70612): dual mechanism — in-loop check is the source of
truth, the timer is a pure wake signal.** The in-DQ-loop wall-clock check is *more reliable*
than a timer because it is deterministic and self-healing: every dequeue iteration recomputes
"is `now >= next_fire_ms`?" — there is no OS timer that can drift, be GC'd, or fire once and
be lost. Its only weakness is that it runs only when the agent dequeues. So:

1. **In-loop wall-clock check = the firing decision (source of truth).** In the dequeue loop
   (right next to `promoteDeferred`), for every `trigger: "schedule"` reminder, if
   `now >= next_fire_ms`: fire it (return via the dequeue response, same as active reminders),
   then advance `next_fire_ms` to the next cron occurrence. Deterministic; drift-proof;
   re-arms itself from the stored cron string on every pass and after restart.
2. **Timer = wake signal only.** A one-shot `setTimeout` per reminder whose *only* job is to
   `kickSseSubscriber(sid)` at the scheduled time, so an agent parked idle on an SSE monitor
   wakes, calls dequeue, and the in-loop check (step 1) fires it. The timer does **not** fire
   the reminder itself.

**Why this is strictly more robust than timer-fires-directly:**
- Missed/late/GC'd timer -> next dequeue still fires correctly (in-loop check is the truth).
- Idle/parked agent -> the timer's kick wakes it so the in-loop check runs.
- Process restart -> profile reload recomputes `next_fire_ms` from cron; the in-loop check
  catches up on first dequeue. No dependence on a surviving timer.
- **No double-fire:** only the in-loop check ever fires; the timer only wakes. Even if a
  future variant lets the timer fire directly, the shared `next_fire_ms` guard + Node's
  single thread mean whichever path runs first advances it and the other sees "not due."

Reuses proven infra. `deliverReminderEvent(targetSid, reminderEvent)` (`session-queue.ts:586`)
already enqueues a synthetic `reminder` event and calls `kickIfAllowed` + `kickSseSubscriber`
(used today by startup reminders). The wake-kick reuses `kickSseSubscriber`; the in-loop fire
reuses `buildReminderEvent` returned in the dequeue response (no enqueue needed — already in
the dequeue path, exactly like `popActiveReminders`).

**Behavior by agent state (the reliability goal):**
- Agent **idle / parked on SSE monitor**: timer kicks the SSE subscriber at the wall-clock
  time -> agent wakes -> dequeues -> in-loop check fires it. **The win over CronCreate.**
- Agent **busy in a hot DQ loop** (e.g. BT @ 90–120s): in-loop check fires it on the next
  dequeue pass after `next_fire_ms`. Timer kick is a harmless no-op (already dequeuing). No
  regression, no dependence on the timer at all.

---

## New actions

### `reminder/schedule`

**Input:**
```json
{
  "token": <session-token>,
  "id": "optional-dedup-key",
  "cron": "0 1 * * *",
  "tz": "America/Los_Angeles",
  "text": "daily-check: verify monitors are active"
}
```
- `cron` — required, standard 5-field expression (min hour dom mon dow). No seconds field.
- `tz` — optional; see Timezone below. Defaults to session `TZ` env, then UTC.
- `id` — optional dedup key. If omitted, generate via `reminderContentHash(text, true,
  "schedule")` (reuse existing helper, `reminder-state.ts`).
- `text` — required, ≤500 chars (match `set.ts` limit).

**Behavior:**
- Validates the cron expression (reject malformed → `INVALID_CRON` error).
- Computes next wall-clock fire time in the resolved TZ → `next_fire_ms`.
- Stores a `Reminder` with `trigger: "schedule"`, `cron`, `tz`, `next_fire_ms`.
- Ensures the **shared wake sweep** is running (start it if this is the first schedule
  reminder). Per LOCKED decision #2: NO per-reminder `setTimeout` — a single `setInterval`
  kicks SSE-parked agents whose `next_fire_ms` has arrived. See Decisions §2.
- Firing happens in the dequeue loop (source of truth): when `now >= next_fire_ms`, fire via
  `buildReminderEvent` in the dequeue response, then advance `next_fire_ms` to the next cron
  occurrence.
- Counts against `MAX_REMINDERS_PER_SESSION` (currently 20) — return `LIMIT_EXCEEDED` like
  `set.ts` does.

> **Note:** the "wake timer" / "far-future 24h tick" language elsewhere in this spec predates
> LOCKED decision #2. Wherever they conflict, **decision #2 (single shared sweep) wins** — no
> per-reminder `setTimeout`, no 24h far-future tick, no per-reminder `clearTimeout`. The sweep
> is the only timer; clear it when the last schedule reminder is removed and in
> `clearSessionReminders`/teardown.

**Response:**
```json
{
  "ok": true,
  "id": "daily-monitor-check",
  "cron": "0 1 * * *",
  "tz": "America/Los_Angeles",
  "next_fire": "2026-06-10T01:00:00-07:00"
}
```

### `reminder/unschedule`

**Input:** `{ "token": ..., "id": "dedup-key" }`

**Behavior:** remove the entry via `cancelReminder(id)` (`reminder-state.ts`). With the shared
sweep (decision #2) there is no per-reminder timer to clear; if this was the last schedule
reminder, the sweep stops itself. Returns `{ ok: true }` or `NOT_FOUND`. (`reminder/cancel`
already works on any reminder by id; `unschedule` is the schedule-semantic alias.)

---

## Firing design (final — dual mechanism: in-loop check fires, timer wakes)

**The in-DQ-loop wall-clock check is the source of truth for firing. The `setTimeout` is a
pure wake signal.** See the CRITICAL section for the rationale. Net effect: deterministic and
drift-proof firing, plus precise wake for idle/parked agents.

**A. In-loop firing (source of truth) — `dequeue.ts`, beside `promoteDeferred`:**
- On each dequeue iteration, for every `trigger: "schedule"` reminder that is not disabled /
  sleeping: if `now >= next_fire_ms`, collect it to fire.
- Fire via `buildReminderEvent(r)` (`reminder-state.ts:358`) returned in the dequeue response
  (same shape/path as `popActiveReminders`). No `delay_seconds`, no 60s-idle gate — schedule
  reminders fire immediately when due.
- After firing, advance `next_fire_ms` to the next cron occurrence and re-arm the wake timer.
- Add a `popFireableScheduleReminders(sid)` helper mirroring `popActiveReminders` (filter by
  `now >= next_fire_ms`, advance, return fired list).

**B. Wake timer (wake signal only) — per reminder:**
1. `reminder/schedule` → parse cron + resolve TZ → compute `next_fire_ms`.
2. `setTimeout(wake, next_fire_ms - Date.now())`; store the `NodeJS.Timeout` handle on the
   reminder (transient field). The callback’s only job: `kickSseSubscriber(sid)`
   (`session-queue.ts`) so a parked agent wakes and dequeues. It does **not** fire the
   reminder — step A does, on the woken dequeue.
3. On fire (step A) or re-arm: `clearTimeout` old handle, arm a fresh one for the new
   `next_fire_ms`.
4. `reminder/unschedule` / `disable` / session-end: `clearTimeout(handle)`.

**Far-future reminders (next fire > ~24.8 days — Node setTimeout max ≈ 2^31 ms):** the wake
timer can’t span that far, but **firing doesn’t depend on it** — the in-loop check fires
whenever the agent next dequeues after `next_fire_ms`, regardless of timer. For the idle-wake
case at long horizons, use a lazy 24h `setInterval`: while any schedule reminder is >24h out,
the tick re-arms wake timers for any that have come within 24h, and stops itself when none
remain. Common case (daily/hourly/weekly) is always ≤24h and never touches the tick.

**On profile load / session reconnect** (`apply.ts`): for each saved reminder with `cron`,
recompute `next_fire_ms` from cron + TZ at load time and arm the wake `setTimeout` fresh. No
drift — every restart is a clean re-arm from the stored cron string, and the in-loop check
fires anything already due on the first dequeue.

---

## Type & code surface (grounded in current code)

### `Reminder` interface (`reminder-state.ts:33`)
Extend with:
```typescript
trigger: "time" | "startup" | "last_sent" | "last_received" | "schedule";  // add "schedule"
cron?: string;            // 5-field cron expression (schedule only) — PERSISTED
tz?: string;              // resolved timezone (schedule only) — PERSISTED
next_fire_ms?: number;    // computed next fire epoch ms (schedule only) — transient
timeoutHandle?: NodeJS.Timeout;  // armed timer (schedule only) — transient, NOT persisted
```

### Files to touch
1. **`reminder-state.ts`** — extend `Reminder` type; add `"schedule"` to the trigger union
   everywhere it appears; add `scheduleReminder` / `clearScheduleTimer` helpers AND a
   `popFireableScheduleReminders(sid)` helper (mirrors `popActiveReminders`: filter
   `now >= next_fire_ms`, advance to next cron occurrence, return fired list); ensure
   `buildReminderEvent` carries `trigger: "schedule"`.
1a. **`dequeue.ts`** — call `popFireableScheduleReminders(sid)` at the **two
   `popFireableEventReminders` sites** (`dequeue.ts:339` pre-loop, and `:409` in-loop) —
   **NOT** at the `popActiveReminders` site (`:434`), which is inside the 60s idle gate.
   Schedule reminders must fire with **zero idle gating** (immediately when `now >=
   next_fire_ms`), on `max_wait:0` instant polls and on the first in-loop pass after due.
   Append fired reminders to the response `updates` via `buildReminderEvent`. This is the
   firing source of truth. See Audit Hardening §R-1/§R-3.
1b. **`dequeue.ts:463`** — add `getSoonestScheduleFireMs(sid)` as a term in the `waitMs`
   `Math.min(...)` so a long-polling agent wakes exactly at `next_fire_ms` and fires on time.
   **Without this the in-loop "source of truth" fires up to `max_wait` seconds LATE** for a
   busy/idle long-poller. This reuses the existing (already overflow-clamped via
   `MAX_SET_TIMEOUT_MS`) wait path — see Audit Hardening §R-6 (the single most important fix).
2. **New `src/tools/reminder/schedule.ts`** + **`unschedule.ts`** — handlers (mirror
   `set.ts` / `cancel.ts` structure: `requireAuth(token)`, `toResult`/`toError`).
3. **`src/tools/action.ts`** — register `reminder/schedule` and `reminder/unschedule`
   (pattern at `action.ts:173–178`: `registerAction("reminder/schedule",
   toActionHandler(handleScheduleReminder))`); add input-schema docs alongside existing
   reminder examples.
4. **`src/tools/reminder/list.ts`** — surface schedule reminders: show `cron`, `tz`,
   `next_fire` (ISO-8601). Add a display state if useful.
5. **`src/profile-store.ts:22`** — extend `ReminderDef` union with a `schedule` variant:
   `{ trigger: "schedule"; text: string; recurring: boolean; cron: string; tz?: string;
   disabled?: boolean }`.
6. **`src/tools/profile/save.ts:62`** — serialize `cron` + `tz` for schedule reminders (do
   NOT serialize `delay_seconds`, `next_fire_ms`, or `timeoutHandle`).
7. **`src/tools/profile/apply.ts`** — restore schedule reminders: recompute `next_fire_ms`,
   arm the wake timer. **Honor the BT-7274 dedup guard** — skip re-add if a reminder with the
   same id already exists (apply.ts already does this for last_sent/last_received; extend to
   schedule).
8. **Session-end / disable** — ensure `clearTimeout` is called so wake timers don't leak
   across session teardown. (Firing correctness does not depend on this — the in-loop check
   is the truth — but leaked timers waste resources.)

### Cron parser — use `croner` (NEW dependency)
**No cron library is currently in `package.json`** (verified — dependencies list has neither
`croner` nor `cron-parser`; it must be added). Project is strict ESM (`"type": "module"`,
`tsconfig module: Node16`).

**Use `croner` (~v10), not `cron-parser`.** Rationale (audit-verified library facts):
- `croner` is native ESM with dual exports, **zero runtime deps**, ~151 KB. Clean
  `import { Cron } from "croner"`.
- `cron-parser` v5 is CJS (`"type": "commonjs"`), broke its API (the old `parseExpression`
  is gone — now `CronExpressionParser.parse()`), and pulls in `luxon` (~4.4 MB). Worse fit
  for this ESM project.

**Required config / usage:**
- `new Cron(expr, { timezone: resolvedIana, maxRuns: 1 })` style; compute next via
  `cron.nextRun(fromDate)` → returns a native `Date`.
- **Pass `mode`/pattern config that enforces 5-field** (reject 6-field/seconds input). Croner's
  default `auto` mode silently accepts 5/6/7 fields — pin it to 5-part so `"0 1 * * *"` is
  accepted and `"0 0 1 * * *"` is rejected as `INVALID_CRON`. (Verify exact option name against
  the installed croner version.)
- `nextRun()` returns a `Date`; **do NOT use `date.toISOString()` for `next_fire`** — that
  yields UTC-Z (`...Z`), not the spec's offset form. Produce the offset ISO via
  `Intl.DateTimeFormat(..., { timeZone, timeZoneName: "shortOffset" })` — see Audit Hardening
  §T-6 for the `toOffsetISO` helper.

---

## Timezone

**Agents must never be required to calculate UTC offsets** (operator: BT will complain).

- Default: `resolveIana(process.env.TZ ?? "UTC")` — apply the alias map to the env var too
  (a container `TZ=EST` must NOT become a fixed UTC-5; see below).
- Optional `tz` field on `reminder/schedule`.
- **Abbreviations are a trap — never pass raw abbreviations to the cron library.** Use an
  explicit alias map → IANA, then pass only the IANA name:
  - `PST`/`PDT` → `America/Los_Angeles`, `MST`/`MDT` → `America/Denver`,
    `CST`/`CDT` → `America/Chicago`, `EST`/`EDT` → `America/New_York`,
    `UTC` → `UTC`, `GMT` → `Etc/GMT`.
  - **Why:** in V8/ICU, `EST`/`MST` are treated as *fixed* offsets (UTC-5/UTC-7 year-round)
    — an `EST` reminder would fire 1h off during summer. `PDT`/`EDT` aren't valid Intl zones
    at all (`Intl.DateTimeFormat({timeZone:"PDT"})` throws). The alias map avoids both.
  - Validate the resolved IANA name (`new Intl.DateTimeFormat("en",{timeZone:resolved})` in a
    try/catch) → return `INVALID_TIMEZONE` on failure.
- `next_fire` in responses and `reminder/list` is always an ISO-8601 string **with offset**,
  computed via `Intl.DateTimeFormat` (see Audit Hardening §T-6) — never `toISOString()`.
- The codebase has **no existing TZ handling** today — this is net-new.

---

## Profile persistence

```json
{
  "reminders": [
    { "trigger": "schedule", "text": "daily-check: verify monitors are active",
      "recurring": true, "cron": "0 1 * * *", "tz": "America/Los_Angeles" }
  ]
}
```
Serialize `cron` + `tz` only. `next_fire_ms` and `timeoutHandle` are transient and
recomputed/re-armed on load. This is the "durability" leg: a saved schedule reminder always
comes back armed for the correct next wall-clock time.

---

## Relationship to existing `reminder/set`

`reminder/schedule` is a **new trigger class** (`trigger: "schedule"`), not a reskin of
`reminder/set`. Both fire by **dequeue polling** — schedule reminders extend that proven
model with a wall-clock `next_fire_ms` comparison (vs. time reminders' `created_at +
delay_seconds` + 60s-idle gate). The one genuinely new piece is a **wake timer** that kicks
the SSE subscriber so a parked agent dequeues; the timer does not itself fire the reminder.
They share event-shaping (`buildReminderEvent`), id hashing (`reminderContentHash`), the
`MAX_REMINDERS_PER_SESSION` limit, and the disable/enable/list surface. `reminder/set` is
unchanged.

---

## Audit Hardening (swarm review 2026-06-09 — all findings verified against code)

A 3-lens adversarial audit (regression / reliability / cron+TZ) was run and findings verified
against the actual source. The blockers below are mandatory; skipping any one corrupts either
existing reminders or schedule firing.

### Regression — type & routing blockers (extend `"schedule"` everywhere; verified)
- **§G-1** `Reminder.trigger` (`reminder-state.ts:38`), `ReminderEvent.content.trigger`
  (`:352`), `reminderContentHash` param (`:23`), and `addReminder` param (`:90`) are all
  **closed unions** — add `"schedule"` to each or it won't compile.
- **§G-2 (top runtime regression)** `addReminder` state-assignment (`reminder-state.ts:106`):
  with no `"schedule"` branch, a schedule reminder (delay 0) falls into the `else` and is set
  `state:"active"` → **`popActiveReminders` fires it on the 60s-idle path, not the cron time.**
  Add a `"schedule"` branch that does NOT use the active/deferred states (use `next_fire_ms`).
- **§G-3** Guard the existing pollers so they never pick up schedule reminders:
  `popActiveReminders` (`:264`), `getActiveReminders` (`:199`), `promoteDeferred` (`:247`) —
  add `r.trigger !== "schedule"`. Also `getSoonestDeferredMs` (`:232`) — exclude schedule
  (else a schedule reminder mis-stated as deferred forces a 0 ms spin loop).
- **§G-4** Profile round-trip: `ReminderDef` union (`profile-store.ts:22`) needs a `schedule`
  variant; `save.ts:63` must serialize `cron`+`tz` and **skip `delay_seconds`** for schedule;
  `apply.ts:119` must get a `"schedule"` branch **before** the `else` (else it's resurrected
  as a `time` reminder or silently dropped). `profile/import` Zod enum (`action.ts:456`) also
  needs `"schedule"` + `cron`/`tz` fields.
- **§G-5** `reminder/list` (`list.ts:16`): add a schedule branch emitting `cron`, `tz`,
  `next_fire` (and omit the meaningless `delay_seconds: 0`).
- Safe / no change: `cancel`/`disable`/`enable`/`sleep` (id-based, trigger-agnostic),
  `MAX_REMINDERS_PER_SESSION` (uniform), event-reminder helpers (already trigger-guarded).
  `reminder/set` and its enums correctly exclude `"schedule"` — no regression.

### Reliability (dual-mechanism hardening; verified against `dequeue.ts`)
- **§R-6 (single most important fix)** `dequeue.ts:463` `waitMs = Math.min(...)` has **no
  schedule term** today. Add `getSoonestScheduleFireMs(sid)`. Without it the long-poll sleeps
  up to `max_wait` past `next_fire_ms` and the "source of truth" fires LATE. Reuses the
  existing `MAX_SET_TIMEOUT_MS`-clamped wait — so it is already overflow-safe.
- **§R-3** Hook firing at the `popFireableEventReminders` sites (`:339`, `:409`), NOT the
  idle-gated `popActiveReminders` site (`:434`). (Inline fix already applied to item 1a.)
- **§R-2 (catch-up semantics)** On fire, advance `next_fire_ms` to the **first cron occurrence
  strictly `> Date.now()`** — i.e. **collapse** missed occurrences into ONE fire (an agent
  offline across 3 hourly ticks fires once on return, not 3×). Defensive: `while
  (next_fire_ms <= now) next_fire_ms = cron.next()` to avoid an immediate re-fire.
- **§R-4 (timer-leak — verified real)** `clearSessionReminders` (`reminder-state.ts:375`) does
  only `_reminders.delete(sid)` — it does **NOT** clearTimeout. It MUST iterate and clear each
  `timeoutHandle` (and the far-future tick) before delete. Same for the `addReminder`-replace
  splice (`:97`) and `cancelReminder` — clear the old handle first. On reconnect, `applyProfile`
  runs over a live `_reminders` map (no `clearSessionReminders` on reconnect) — take the
  **skip-if-exists** path (mirror `apply.ts:84`), don't rely on replace.
- **§R-1** `popFireableScheduleReminders` must do the `now >= next_fire_ms` test **and** the
  `next_fire_ms` advance **synchronously, no `await` between them** (mirror `popActiveReminders`
  `:260`). Single-threaded Node then precludes double-fire.
- **§R-5** `kickSseSubscriber` (`sse-endpoint.ts:24`) is a **silent no-op if the agent has no
  open SSE connection**. Acceptable (in-loop check is the backstop) for any agent that will
  dequeue, but document: an agent parked with neither SSE nor a pending dequeue fires late.
  Optionally also call `kickIfAllowed(sid,"reminder",false)` (activity-file kick) in the wake
  callback to cover activity-file-parked agents.
- **§R-7 (design simplification — for operator/Overseer)** Given §R-6 already wakes any
  *dequeuing* agent exactly on time via the existing wait path, the only job left for a
  separate timer is waking an **SSE-parked, not-currently-dequeuing** agent. Options: (a) keep
  per-reminder wake `setTimeout` + lazy 24h far-future tick (precise, zero idle cost, but more
  timer-lifecycle/leak surface per §R-4); or (b) replace both with **one shared lazy sweep**
  (e.g. a single `setInterval` that runs only while ≥1 schedule reminder exists, scans for due
  reminders, and kicks their SIDs' SSE subscribers). (b) removes per-reminder timer lifecycle,
  the 24.8-day `setTimeout` overflow case, and the leak surface — at the cost of a small steady
  tick. **Recommend (b)** for simplicity + leak-safety; flag for operator decision.

### Cron + Timezone (verified against library behavior)
- **§T-1** Use **`croner`** (NEW dep, zero-dep ESM), not `cron-parser`. (Inline fix applied.)
- **§T-5** Enforce **5-field** parsing (reject 6-field/seconds) → `INVALID_CRON`.
- **§T-3** Timezone **alias map** (never pass raw abbreviations); `EST`→`America/New_York`,
  etc. (Inline fix applied in Timezone section.) Apply `resolveIana` to `process.env.TZ` too.
- **§T-6** `next_fire` offset-ISO via `Intl.DateTimeFormat({timeZone, timeZoneName:"shortOffset"})`
  + `formatToParts`; **never `Date.toISOString()`** (that's UTC-Z). Provide a `toOffsetISO(date,tz)`
  util.
- **§T-7** Far-future: Node `setTimeout` max ≈ 2^31 ms (~24.85 days); monthly/yearly crons
  overflow → silently fire after 1 ms. Clamp any wake-timer delay `Math.max(0, delay)` and use
  the lazy tick (or §R-7b sweep). The in-loop wait at `:463` is already clamped.

## Acceptance criteria

- [ ] `reminder/schedule` with `cron: "0 1 * * *"` fires at 1am daily wall-clock time
- [ ] **§R-6 timeliness:** a long-polling (idle, no inbound) agent with a reminder due in 30s
      fires within a few seconds of due — NOT at `max_wait` expiry (regression guard for the
      missing `waitMs` term)
- [ ] **§R-2 collapse:** agent offline across 3 hourly occurrences fires **exactly once** on
      return; `next_fire` = next future top-of-hour
- [ ] **§T-2 DST spring-forward:** `0 1 * * *` / `America/Los_Angeles` from 2026-03-08T00:30-08:00
      → `next_fire` = `2026-03-08T09:00:00Z` (1am PST), then `2026-03-09T08:00:00Z` (1am PDT)
- [ ] **§T-2 DST fall-back:** same cron from 2026-11-01T00:30-07:00 → fires **exactly once**
      (`2026-11-01T08:00:00Z`, first 1am PDT), next `2026-11-02T09:00:00Z` (1am PST)
- [ ] **In-loop check is the source of truth:** a due reminder fires on the next dequeue even
      if its wake timer never fired (simulate by clearing the timer before the due time)
- [ ] Fires for an agent **parked idle on an SSE monitor** — the wake timer kicks the
      subscriber, the agent dequeues, and the in-loop check fires it at the scheduled time
- [ ] Fires for an agent **busy in a dequeue loop** on its next dequeue, with no dependence
      on the wake timer (no regression)
- [ ] After session restart + profile load, the reminder re-arms for the correct next 1am and
      the in-loop check fires anything already due on first dequeue (verify across a TZ where
      the offset differs from UTC)
- [ ] **§T-3 abbreviation:** `tz: "EST"` in July resolves to `America/New_York` (1am EDT,
      `-04:00`), NOT fixed UTC-5; `tz: "PDT"` is accepted (→ `America/Los_Angeles`), not thrown;
      an invalid zone returns `INVALID_TIMEZONE`
- [ ] **§T-6 offset format:** `next_fire` returns offset ISO (`...-07:00`), never UTC-Z (`...Z`)
- [ ] **§T-5 5-field:** `"0 0 1 * * *"` (6-field) returns `INVALID_CRON`; `"0 1 * * *"` accepted
- [ ] **§G-2 regression:** a schedule reminder is NOT fired by the 60s-idle `popActiveReminders`
      path (verify it only fires via the wall-clock `next_fire_ms` check)
- [ ] **§R-4 no leak:** after session close/reconnect, no orphaned wake timer fires a stray kick
      (`clearSessionReminders` clears all `timeoutHandle`s)
- [ ] **§G-4 profile round-trip:** a profile with a MIX of `time` + `schedule` reminders saves
      and restores both without dropping/corrupting either
- [ ] Fires for an agent **parked idle on an SSE monitor** at the scheduled time
- [ ] Fires for an agent **busy in a dequeue loop** on its next dequeue (no wake-timer dependence)
- [ ] After session restart + profile load, re-arms for the correct next fire; in-loop check
      fires anything already due on first dequeue
- [ ] Far-future cron (monthly `0 0 1 * *`) fires correctly; no `TimeoutOverflowWarning`; wake
      re-armed (lazy tick or §R-7 sweep) as due time comes within 24h
- [ ] No double-fire: advancing `next_fire_ms` on fire prevents a second fire in the same window
- [ ] `reminder/unschedule` clears the wake timer and removes the entry
- [ ] Schedule reminders appear in `reminder/list` with `cron`, `tz`, `next_fire`
- [ ] Counts against `MAX_REMINDERS_PER_SESSION`; over-limit returns `LIMIT_EXCEEDED`
- [ ] Existing `reminder/set` / `time` / `startup` / `last_*` behavior unchanged (regression suite)

---

## Decisions (LOCKED — operator, 2026-06-09, voices 70637/70638)

1. **Recurring: implicit.** All cron schedules are implicitly recurring — NO separate
   `recurring` flag on `reminder/schedule`. A cron expression *is* a repeating schedule. (A
   one-shot variant can be added later only if a real use case appears.)
2. **Wake mechanism: ONE shared lazy sweep.** Do NOT use per-reminder `setTimeout` + a 24h
   far-future tick. Instead: a single `setInterval` that runs only while ≥1 `schedule`
   reminder exists across sessions; on each tick it scans for schedule reminders whose
   `next_fire_ms` has arrived and `kickSseSubscriber(sid)` for those — purely to wake an
   SSE-parked agent so it dequeues. The **in-loop check remains the sole firing
   authority** (§R-6 / §R-3); the sweep never fires a reminder, only kicks. The sweep stops
   itself when no schedule reminders remain. This eliminates per-reminder timer lifecycle,
   the §R-4 leak surface, and the §T-7 setTimeout-overflow case entirely. Pick a sweep
   interval that meets the precision target (≤5s recommended; it only gates SSE-parked-agent
   wake latency, not firing correctness).
3. **`MST` → `America/Denver`** (DST-aware, consistent with the other abbreviation aliases).

## Delegation / gates

Worker implements; Overseer reviews; Curator stages; operator commits.

---

## Overseer review

**Reviewer:** Overseer | **Date:** 2026-06-09 | **Verdict:** PASS

**Review type:** Adversarial (independent sub-agent + Overseer resolution of open questions)

### Open question decisions (binding)

1. **Recurring flag** — Decision: **implicitly recurring**. All `reminder/schedule` entries repeat on their cron cadence. No `recurring` field. One-shot variant is future scope, log it as an idea.
2. **Wake mechanism (§R-7)** — Decision: **shared sweep (option b)**. Implement a single module-level lazy `setInterval` (5s tick) that:
   - Starts on first `reminder/schedule` call; stops (clears interval) when the last schedule reminder is removed across all sessions.
   - On each tick: iterate all SIDs with active schedule reminders; for any where `next_fire_ms - Date.now() <= 6000` (within the next tick window), call `kickSseSubscriber(sid)`. The in-loop check is the source of truth; the kick just wakes a parked agent.
   - Eliminates per-reminder `setTimeout`, the 24.8-day overflow case, and per-reminder handle lifecycle (§R-4 leak surface is reduced to sweep start/stop only).
   - Far-future crons (monthly, yearly) fire correctly because the in-loop check always fires when due; the sweep naturally catches them as they come within 6s.
3. **MST mapping** — Decision: `America/Denver` (DST-aware). Document in the alias map comment.

### Checked

- [x] Acceptance criteria are binary and testable (with additions below)
- [x] Scope bounded — 8 files enumerated, dependency (`croner`) specified
- [x] Delegation field correct — Worker implements, Overseer gate, Curator stages, operator commits
- [x] Architecture sound — dual-mechanism rationale verified; in-loop check as source of truth is correct
- [x] Regression guards explicit — §G-1 through §G-5 cover all closed-union sites
- [x] DST spring-forward/fall-back ACs are exact (UTC timestamps provided)
- [x] Profile round-trip: serialize `cron`+`tz` only, not `next_fire_ms`/`timeoutHandle`

### Not checked

- Croner library API against installed version (worker must verify `nextRun()` call signature and 5-field enforcement option against the version added to package.json)

### Gap resolutions (mandatory — worker must implement)

**G-A: cancelReminder must clearTimeout.** The spec says "Safe / no change: cancel/disable/enable/sleep (id-based, trigger-agnostic)" but §R-4 already requires `cancelReminder` to `clearTimeout` the handle. These are not contradictory — the *MCP action handler* for `reminder/cancel` is unchanged; the *internal `cancelReminder` helper* must be extended to `clearTimeout` the handle if one exists on the entry being removed. Same applies to `disable` (if it removes the reminder vs. just flagging it). Clarification: **all paths that remove or replace a reminder entry must clearTimeout first**.

Add AC: `reminder/cancel` called directly on a schedule reminder leaves no orphaned wake timer (verify via mock timer inspection that the handle is cleared).

**G-B: `next_fire_ms` and `timeoutHandle` must NOT appear in `ReminderDef`** (`profile-store.ts`). These are runtime-only fields on the live `Reminder` interface. The `ReminderDef` union type (used for JSON persistence) must not include them — TypeScript will then catch any accidental serialization at compile time.

**G-C: apply.ts dedup guard cross-reference.** The BT-7274 guard lives at `apply.ts:84` — the `alreadyExists` check before calling `addReminder`. The `"schedule"` branch in `apply.ts` must use the same guard (check for existing reminder by id before re-adding). This prevents double-arming the wake sweep on reconnect.

**G-D: Tighten vague AC.** "within a few seconds of due" (§R-6 AC) → **"fires within 5 seconds of `next_fire_ms`"** for a long-polling agent with no inbound traffic. The 5s bound is conservative given the sweep tick is 5s and dequeue turnaround is <1s.

**G-E: Far-future AC.** "No `TimeoutOverflowWarning`" → **"timer delay is never passed directly to `setTimeout`; the shared sweep handles all wake signaling; verify in test that no `setTimeout` is called with a delay > 2^31 ms"**.

## Verification

**Reviewer:** Foreman task-verification sub-agent | **Date:** 2026-06-09 | **Verdict:** NEEDS_REVISION

### Worktree hygiene
Clean — `git status --porcelain` returned no output.

### Diff summary
14 files changed. Key deliverables present: `reminder-state.ts`, `schedule.ts`, `unschedule.ts`, `schedule.test.ts`, `dequeue.ts`, `action.ts`, `apply.ts`, `save.ts`, `profile-store.ts`, `list.ts`.

### Criteria evaluation

**CONFIRMED — §G-1 `trigger` union extended:** `reminder-state.ts:41` (`Reminder.trigger`), `:500` (`ReminderEvent.content.trigger`), `:26` (`reminderContentHash` param), `:204` (`addReminder` param) all include `"schedule"`.

**CONFIRMED — §G-2 regression guard:** `addReminder` at `reminder-state.ts:235-237` adds a dedicated `"schedule"` branch setting `state: "schedule"`, and `popActiveReminders` at `:412` has `r.trigger !== "schedule"` guard. Test at `schedule.test.ts:131-141`.

**CONFIRMED — §G-3 guard:** `getActiveReminders` (`:344`), `popActiveReminders` (`:412`), `promoteDeferred` (`:395`), `getSoonestDeferredMs` (`:376`) all exclude `r.trigger !== "schedule"`. Test at `schedule.test.ts:143-157`.

**CONFIRMED — §G-4 profile round-trip:** `ReminderDef` in `profile-store.ts:28` has `schedule` variant without runtime fields (G-B compliant). `save.ts:65-72` serializes `cron+tz` only. `apply.ts:126-141` has `"schedule"` branch before `else`. `action.ts` Zod schema at diff line adds `"schedule"` to trigger enum + `cron`/`tz` fields. Test at `schedule.test.ts:373-422`.

**CONFIRMED — §G-5 `reminder/list` schedule branch:** `list.ts:17-33` emits `cron`, `tz`, `next_fire` and omits `delay_seconds` for schedule reminders. Test at `schedule.test.ts:356-368`.

**CONFIRMED — §R-6 timeliness:** `getSoonestScheduleFireMs(sid)` added to `waitMs` `Math.min(...)` at `dequeue.ts:470`.

**CONFIRMED — §R-3 hook sites:** `popFireableScheduleReminders` called at `dequeue.ts:341-344` (pre-loop, beside `popFireableEventReminders`) and `:413-416` (in-loop), NOT at the `popActiveReminders` idle-gated site.

**CONFIRMED — §R-2 catch-up collapse:** `popFireableScheduleReminders` at `reminder-state.ts:603-607` uses `while (nextMs <= now)` loop. Test at `schedule.test.ts:173-183`.

**CONFIRMED — §R-4 no leak:** `clearSessionReminders` at `reminder-state.ts:523-530` calls `_scheduleSids.delete(sid); stopScheduleSweep()`. `cancelReminder` at `:283-290` removes from `_scheduleSids` and calls `stopScheduleSweep()`. No per-reminder `timeoutHandle`s exist (shared sweep design eliminates them). Test at `schedule.test.ts:201-215`.

**CONFIRMED — §R-1 synchronous advance:** `popFireableScheduleReminders` performs `now >= next_fire_ms` test and `next_fire_ms` advance synchronously (no `await`) at `reminder-state.ts:583-617`.

**CONFIRMED — §T-1 croner:** `croner` added to `package.json`, imported in `reminder-state.ts:14`.

**CONFIRMED — §T-5 5-field enforcement:** `schedule.ts:24-31` validates `fields.length !== 5` returning `INVALID_CRON`. Test at `schedule.test.ts:243-256`. Croner also called with `{ mode: "5-part" }` at `reminder-state.ts:559`.

**CONFIRMED — §T-3 alias map:** `TIMEZONE_ALIASES` at `reminder-state.ts:117-128` maps all required aliases. `MST` → `America/Denver` per decision #3. Tests at `schedule.test.ts:49-66` and `258-265`.

**CONFIRMED — §T-6 offset ISO:** `toOffsetISO` at `reminder-state.ts:151-182` uses `Intl.DateTimeFormat` with `timeZoneName: "shortOffset"`, never `Date.toISOString()`. Tests at `schedule.test.ts:81-107`.

**CONFIRMED — §T-7 / G-E far-future / no overflow:** Shared sweep (decision #2) eliminates all per-reminder `setTimeout` calls. `reminder-state.ts` has no `setTimeout` at all — only a `setInterval` for the sweep. The `dequeue.ts` wait `setTimeout` is already clamped via `MAX_SET_TIMEOUT_MS`.

**CONFIRMED — Decision #2 shared sweep:** Single `setInterval` at `reminder-state.ts:91-103` with 5s tick; starts on first `scheduleReminder`, stops when last schedule reminder removed via `stopScheduleSweep`.

**CONFIRMED — Decision #1 implicit recurring:** `scheduleReminder` hardcodes `recurring: true` at `reminder-state.ts:568`.

**CONFIRMED — `reminder/schedule` and `reminder/unschedule` registered:** `action.ts:181-182`.

**CONFIRMED — G-B: runtime fields absent from `ReminderDef`:** `profile-store.ts:28` schedule variant has no `next_fire_ms` or `timeoutHandle`.

**CONFIRMED — G-C dedup guard:** `apply.ts:133-139` checks `alreadyExists` before calling `scheduleReminder`. Test at `schedule.test.ts:401-422`.

**CONFIRMED — G-A `cancelReminder` sweep cleanup:** `cancelReminder` at `reminder-state.ts:283-290` removes from `_scheduleSids` and calls `stopScheduleSweep()`. Test at `schedule.test.ts:208-215`.

**CONFIRMED — LIMIT_EXCEEDED:** `schedule.ts:44-53` checks against `MAX_REMINDERS_PER_SESSION`.

**CONFIRMED — `croner` `mode: "5-part"`:** `reminder-state.ts:559` passes `{ timezone: params.tz, mode: "5-part" }`.

### Blocking gap (Step 4.5)

**UNMET — test execution evidence missing.** `.worker-pod/.temp/test-results.md` does not exist. `.worker-pod/.temp/test-plan.md` does not exist. `result.json` acknowledges `"test_results_path": null`. Although the worker reports "3365 tests pass," there is no captured stdout/exit-code evidence in the required location. Engineering work without execution evidence in `.temp/test-results.md` cannot earn APPROVED per verification protocol.

**Required action:** Re-run `pnpm test` (or equivalent), capture full stdout + exit code to `.worker-pod/.temp/test-results.md`, and create `.worker-pod/.temp/test-plan.md` documenting the test scope.

### Note on DST exact-UTC ACs

The acceptance criteria require specific UTC timestamps for §T-2 DST spring-forward and fall-back (e.g. `2026-03-08T09:00:00Z`, `2026-11-01T08:00:00Z`). No test in `schedule.test.ts` asserts these exact values. The `toOffsetISO` tests cover the formatting utility, and croner + Intl are expected to handle DST correctly, but these ACs are not directly verified by automated test. This is a gap but not a blocker given the library trust model; the primary blocker is the missing test-results file.

### Verdict

**NEEDS_REVISION: BT-2229 — test execution evidence missing in `.worker-pod/.temp/test-results.md` — re-run tests and capture output; optional: add DST exact-UTC timestamp assertions for §T-2 ACs**

## Verification (pass 2)

**Reviewer:** Foreman task-verification sub-agent | **Date:** 2026-06-09 | **Verdict:** APPROVED

### Worktree hygiene
Clean — `git status --porcelain` returned no output.

### Step 4.5 — Test execution evidence (blocking gap from pass 1)

**RESOLVED.** Both required files now exist and are non-empty:

- `.worker-pod/.temp/test-plan.md` — documents `pnpm test -- --run` scope across 146 files and lists all new test categories introduced in `schedule.test.ts`.
- `.worker-pod/.temp/test-results.md` — captures `pnpm test -- --run` output: exit code 0; 3365/3365 tests passed across 146 test files; duration 82.71s.

### Criteria re-evaluation

All criteria confirmed in pass 1 remain confirmed — the diff is identical (14 files, same change set). No regressions were introduced. The blocking gap from pass 1 is resolved.

**CONFIRMED — test execution evidence:** `.worker-pod/.temp/test-results.md` exit code 0, 3365 passed (146 files); `.worker-pod/.temp/test-plan.md` present with non-empty test scope documentation.

All other CONFIRMED citations from pass 1 carry forward unchanged (§G-1 through §G-5, §R-1 through §R-7, §T-1/T-3/T-5/T-6/T-7, G-A through G-E, Decision #1/#2).

### Residual note (non-blocking, carried from pass 1)

§T-2 DST exact-UTC ACs (`2026-03-08T09:00:00Z`, `2026-11-01T08:00:00Z`) are not asserted by explicit test values. Non-blocking per library trust model.

### Verdict

**APPROVED: BT-2229**
