Forced-Stop Recovery — Detection and recovery after context-limit termination.

Distinct from compaction. Agent had zero tokens — no handoff, no session/close, no DM.

## Scenario Comparison
| Scenario      | Signal                            | Recovery topic   |
| compaction    | Context truncated, session alive  | compacted        |
| graceful      | Operator says stop, handoff written | shutdown        |
| forced stop   | Context limit hit, hook passes through | forced-stop  |

## Periodic Checkpoint (Dead Man's Switch)
Every 10 dequeue cycles, write checkpoint to session memory file:

  ## Checkpoint
  Written: <ISO 8601 timestamp>
  Cycle: <loop cycle count>
  SID: <your SID>
  Status: <idle | in-progress: task-id>

Write checkpoint BEFORE processing messages on 10th cycle.
Silent failure OK — never let checkpoint failure interrupt dequeue loop.
Write in addition to token block — never replace it.

## Forced-Stop Detection on Startup
Read session memory file before testing session:
| Condition                                    | Interpretation        |
| Empty or missing                             | Fresh start           |
| Token present, no checkpoint                 | Clean start (<10 cycles) |
| Checkpoint + handoff non-blank               | Clean shutdown        |
| Checkpoint + handoff blank/missing           | Forced stop           |
| Checkpoint + no handoffs used (e.g. Worker)  | Compare timestamp → if gap >30 min, forced stop |

## Announcing Forced-Stop Recovery
DM Curator immediately after reconnecting (before drain, before profile):
  "⚠️ Forced-stop recovery: terminated uncleanly (context limit or hard stop).
   Last checkpoint: <timestamp>, Cycle: <N>, Status: <idle|task-id>.
   Resuming now."

Use ⚠️ Forced-stop recovery prefix — distinct from compaction recovery phrasing.

## Fleet Detection (Curator/Overseer)
Orphan signs: session in list, no recent DM, no session/close observed, stale checkpoint.
Action: DM SID → wait one timeout → no reply → DM Curator → on confirmation, respawn.
Do NOT close another agent's session. Bridge cleans up orphaned token on replacement start.

Full reference: skills/telegram-mcp-forced-stop-recovery/SKILL.md
