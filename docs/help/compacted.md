Post-Compaction Recovery

You just lost conversational context. Follow these steps:

1. Read your agent file (CLAUDE.md) — it has your identity and routing pointers.
2. Read startup-context.md in your agent folder — full operating procedures.
3. Read recovery-context.md in your agent folder — session state and invariants.
4. Test Telegram: dequeue(max_wait: 0, token) — drain any pending messages.
5. Check session memory file for token and SID.
6. If token is lost: action(type: 'session/reconnect', name: '<your_name>').
7. Resume your dequeue loop or last task.

Key: your agent file is the router. It tells you where everything else lives.
