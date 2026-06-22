/**
 * session/unblock — governor action to clear a closed-session marker.
 *
 * When a session is closed, `closeSessionById()` records a closed-session
 * marker keyed by the session's connectionToken. Any subsequent
 * `session/reconnect` or `session/start` (refresh:true) call that presents
 * that token is immediately rejected with CALLER_CLOSED.
 *
 * This action allows the governor to lift that block for a specific caller
 * by clearing the marker. Once cleared, the caller may reconnect normally
 * (subject to the usual operator-approval dialog).
 *
 * This is a governor-only action (registered with `{ governor: true }` in
 * action.ts).
 */

import { toResult, toError } from "../../telegram.js";
import { clearClosedMarker } from "../../session-manager.js";

export async function handleSessionUnblock({
  connection_token,
}: {
  connection_token?: string;
}) {
  if (!connection_token) {
    return toError({
      code: "MISSING_CONNECTION_TOKEN",
      message:
        "connection_token is required for session/unblock. " +
        "Pass the token delivered in the session_closed_token service event " +
        "or from the Telegram notification when the session closed.",
    });
  }

  const cleared = clearClosedMarker(connection_token);
  return toResult({
    unblocked: cleared,
    connection_token,
    hint: cleared
      ? "Closed-session marker cleared. The caller may now reconnect via session/reconnect or session/start (refresh: true)."
      : "No active closed-session marker found for this connection_token. " +
        "It may have already been cleared or naturally expired (TTL: 24 h).",
  });
}
