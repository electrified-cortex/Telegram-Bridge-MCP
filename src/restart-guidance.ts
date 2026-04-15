/** Shared restart guidance appended to both shutdown and pre-warning messages. */
export const RESTART_GUIDANCE =
  "Wait ~30s for restart, then probe: action(type: \"session/list\") — no token needed. " +
  "If your SID is in the list, try dequeue(token: <saved>) directly — if it succeeds, you're reconnected. " +
  "If that fails, call action(type: \"session/reconnect\", name: \"...\") to request reconnect approval. " +
  "SID missing → bridge restarted fresh → session/start.";
