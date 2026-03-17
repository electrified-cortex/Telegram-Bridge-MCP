import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, sendServiceMessage, resolveChat } from "../telegram.js";
import { closeSession, getSession, getActiveSession, setActiveSession, listSessions } from "../session-manager.js";
import { removeSessionQueue, drainQueue, deliverDirectMessage, routeToSession } from "../session-queue.js";
import { revokeAllForSession } from "../dm-permissions.js";
import { getGovernorSid, setRoutingMode } from "../routing-mode.js";
import { SESSION_AUTH_SCHEMA, checkAuth } from "../session-auth.js";
import { replaceSessionCallbackHooks } from "../message-store.js";

const DESCRIPTION =
  "Close the current session. Removes it from the active " +
  "session list and cleans up resources. The session ID " +
  "cannot be reclaimed after closure.";

export function register(server: McpServer) {
  server.registerTool(
    "close_session",
    {
      description: DESCRIPTION,
      inputSchema: {
        ...SESSION_AUTH_SCHEMA,
      },
    },
    ({ sid, pin }) => {
      const authErr = checkAuth(sid, pin);
      if (authErr) return authErr;

      // Capture session name before closing (used in notifications)
      const sessionInfo = getSession(sid);
      const sessionName = sessionInfo?.name || `Session ${sid}`;

      // Drain orphaned queue items BEFORE removing the queue so we can reroute
      const orphaned = drainQueue(sid);

      const closed = closeSession(sid);
      if (!closed) return toResult({ closed: false, sid });

      removeSessionQueue(sid);
      revokeAllForSession(sid);
      if (getActiveSession() === sid) setActiveSession(0);

      const wasGovernor = sid === getGovernorSid();
      const remaining = listSessions().sort((a, b) => a.sid - b.sid);

      // Always notify the operator that this session disconnected
      sendServiceMessage(`🤖 ${sessionName} has disconnected.`).catch(() => {});

      if (remaining.length === 1) {
        // 2 → 1: single-session mode restored — always reset routing
        const last = remaining[0];
        setRoutingMode("load_balance");
        sendServiceMessage(
          wasGovernor
            ? "⚠️ Governor session closed. Single-session mode restored."
            : "ℹ️ Session closed. Single-session mode restored.",
        ).catch(() => {});
        deliverDirectMessage(0, last.sid, "📢 Single-session mode restored. Routing reset to load balance.");
      } else if (wasGovernor) {
        if (remaining.length === 0) {
          // Last session (was governor): reset routing
          setRoutingMode("load_balance");
          sendServiceMessage(
            "⚠️ Governor session closed. Routing mode reset to *load_balance*.",
          ).catch(() => {});
        } else {
          // Governor closes with 2+ remaining: promote lowest-SID
          const next = remaining[0];
          setRoutingMode("governor", next.sid);
          const label = next.name || `Session ${next.sid}`;
          sendServiceMessage(
            `⚠️ Governor session closed. 🤖 ${label} promoted to governor.`,
          ).catch(() => {});
        }
      }
      // Non-governor closes with 0 or 2+ remaining: no routing change needed

      // Reroute orphaned queue items to remaining sessions
      if (orphaned.length > 0 && remaining.length > 0) {
        for (const event of orphaned) {
          routeToSession(event, event.event === "callback" ? "response" : "message");
        }
        dlogOrphans(sid, orphaned.length);
      }

      // Replace any pending callback hooks owned by this session with a "Session closed" ack.
      // This ensures late button presses get a graceful response rather than the original action.
      replaceSessionCallbackHooks(sid, (evt) => {
        const qid = evt.content.qid;
        if (qid) {
          void getApi().answerCallbackQuery(qid, { text: "Session closed" })
            .catch(() => { /* non-fatal */ });
        }
        // Remove inline keyboard from the message
        const chatId = resolveChat();
        const target = evt.content.target;
        if (typeof chatId === "number" && target) {
          void getApi()
            .editMessageReplyMarkup(chatId, target, { reply_markup: { inline_keyboard: [] } })
            .catch(() => { /* non-fatal */ });
        }
      });

      return toResult({ closed: true, sid });
    },
  );
}

function dlogOrphans(sid: number, count: number): void {
  process.stderr.write(`[session-teardown] rerouted ${count} orphaned event(s) from sid=${sid}\n`);
}
