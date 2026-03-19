import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError, sendServiceMessage, resolveChat } from "../telegram.js";
import { closeSession, getSession, getActiveSession, setActiveSession, listSessions } from "../session-manager.js";
import { removeSessionQueue, drainQueue, deliverDirectMessage, deliverServiceMessage, routeToSession } from "../session-queue.js";
import { revokeAllForSession } from "../dm-permissions.js";
import { getGovernorSid, setGovernorSid } from "../routing-mode.js";
import { requireAuth } from "../session-gate.js";
import { replaceSessionCallbackHooks } from "../message-store.js";
import { dlog } from "../debug-log.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

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
        identity: IDENTITY_SCHEMA,
      },
    },
    ({ identity }) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      // Capture session name before closing (used in notifications)
      const sessionInfo = getSession(sid);
      const sessionName = sessionInfo?.name || `Session ${sid}`;

      const closed = closeSession(sid);
      if (!closed) return toResult({ closed: false, sid });

      // Drain orphaned queue items after close succeeds so we can reroute
      const orphaned = drainQueue(sid);

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
        setGovernorSid(0);
        sendServiceMessage(
          wasGovernor
            ? "⚠️ Governor session closed. Single-session mode restored."
            : "ℹ️ Session closed. Single-session mode restored.",
        ).catch(() => {});
        deliverDirectMessage(0, last.sid, "📢 Single-session mode restored. Governor cleared.");
      } else if (wasGovernor) {
        if (remaining.length === 0) {
          // Last session (was governor): reset routing
          setGovernorSid(0);
          sendServiceMessage(
            "⚠️ Governor session closed. No sessions remain.",
          ).catch(() => {});
        } else {
          // Governor closes with 2+ remaining: promote lowest-SID
          const next = remaining[0];
          setGovernorSid(next.sid);
          const label = next.name || `Session ${next.sid}`;
          sendServiceMessage(
            `⚠️ Governor session closed. 🤖 ${label} promoted to governor.`,
          ).catch(() => {});
          // Notify the promoted governor
          deliverServiceMessage(
            next.sid,
            `You are now the governor (${sessionName} closed). Ambiguous messages will be routed to you.`,
            "governor_promoted",
            { closed_sid: sid, closed_name: sessionName, new_governor_sid: next.sid },
          );
          // Notify other remaining sessions of the new governor
          for (const s of remaining.slice(1)) {
            deliverServiceMessage(
              s.sid,
              `Session '${sessionName}' (SID ${sid}) has ended. '${label}' (SID ${next.sid}) is now the governor.`,
              "session_closed",
              { closed_sid: sid, closed_name: sessionName, new_governor_sid: next.sid },
            );
          }
        }
      }

      // Notify all remaining sessions of the closure (for non-governor cases, or always)
      if (remaining.length > 0 && !(wasGovernor && remaining.length >= 2)) {
        // For non-governor close, or 2→1, notify remaining sessions
        for (const s of remaining) {
          deliverServiceMessage(
            s.sid,
            `Session '${sessionName}' (SID ${sid}) has ended.`,
            "session_closed",
            { closed_sid: sid, closed_name: sessionName },
          );
        }
      }
      // Non-governor closes with 0 or 2+ remaining: no routing change needed

      // Reroute orphaned queue items to remaining sessions
      if (orphaned.length > 0 && remaining.length > 0) {
        for (const event of orphaned) {
          routeToSession(event);
        }
        dlogOrphans(sid, orphaned.length);
      }

      // Replace any pending callback hooks owned by this session with a "Session closed" ack.
      // This ensures late button presses get a graceful response rather than the original action.
      replaceSessionCallbackHooks(sid, (evt) => {
        const qid = evt.content.qid;
        if (qid) {
          void getApi().answerCallbackQuery(qid, { text: "Session closed" })
            .catch((err: unknown) => {
              dlog("session", `callback ack failed for qid=${qid}: ${String(err)}`);
            });
        }
        // Remove inline keyboard from the message
        const chatId = resolveChat();
        const target = evt.content.target;
        if (typeof chatId === "number" && target) {
          void getApi()
            .editMessageReplyMarkup(chatId, target, { reply_markup: { inline_keyboard: [] } })
            .catch((err: unknown) => {
              dlog("session", `callback hook cleanup failed for msg ${target}: ${String(err)}`);
            });
        }
      });

      return toResult({ closed: true, sid });
    },
  );
}

function dlogOrphans(sid: number, count: number): void {
  dlog("session", `[session-teardown] rerouted ${count} orphaned event(s) from sid=${sid}`);
}
