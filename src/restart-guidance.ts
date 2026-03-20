/** Shared restart guidance appended to both shutdown and pre-warning messages. */
export const RESTART_GUIDANCE =
  "When you receive a shutdown event, stop retrying dequeue_update. After the server restarts (typically 10\u201360 s), call session_start to establish a new session.";
