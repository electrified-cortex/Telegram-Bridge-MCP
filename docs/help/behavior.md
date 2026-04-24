# help: behavior

The TMCP behavioral-shaping layer delivers guidance as service messages or envelope hints — as strong as operator speech, lazy-loaded at the moment they become relevant.

## Severity tiers

| Tier | Channel | Weight | When to use |
|---|---|---|---|
| **service-message** | Session queue — appears as an `updates` event on next dequeue | Interruption-weight | Behavioral corrections that must be adopted; semantics the agent is misusing |
| **hint** | `hint` field on dequeue response — lightweight, in-band | Suggestion-weight | Soft nudges, timing suggestions, ambient guidance the agent can choose to act on |

Service messages are reserved for things that genuinely need to change. Hints are "you might want to" signals. Defaulting everything to service-message inflates the queue and erodes signal weight.

## Active rules

| Name | Severity | Trigger | Help topic |
|---|---|---|---|
| `reaction_semantics` | service-message | first react() | reactions |
| `presence_silence_rung1` | hint | silence > threshold | presence |
| `presence_silence_rung2` | service-message | silence > 2× threshold | presence |
| `first_message` | service-message | first operator message | reactions |
| `slow_gap` | service-message | slow activity gap | reactions |
| `typing_rate` | service-message | low show-typing rate | show-typing |
| `question_hint` | service-message | first question without buttons | send |
| `question_escalation` | service-message | 10+ questions without buttons | send |

## Adding a new rule

1. Add a `BehaviorRuleSpec` entry to `BEHAVIOR_REGISTRY` in `src/behavior-registry.ts`
2. Add the service message constant to `src/service-messages.ts`
3. Wire the trigger in `src/server.ts dispatchBehaviorTracking` (or the relevant detector)
4. Update this table

## Per-session disable

Not yet exposed via API. Future work: `action(type: "behavior/disable", rule: "<name>")`.

See also: `help(topic: 'reactions')`, `help(topic: 'presence')`, `help(topic: 'modality')`
