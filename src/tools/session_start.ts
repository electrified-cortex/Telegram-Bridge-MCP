import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import type { TimelineEvent } from "../message-store.js";
import { dequeue, registerCallbackHook, clearCallbackHook } from "../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions, activeSessionCount, getSession, getAvailableColors, COLOR_PALETTE, setSessionAnnouncementMessage, getSessionAnnouncementMessage } from "../session-manager.js";
import { createSessionQueue, removeSessionQueue, deliverServiceMessage, trackMessageOwner, getSessionQueue } from "../session-queue.js";
import { setGovernorSid, getGovernorSid } from "../routing-mode.js";
import { runInSessionContext } from "../session-context.js";
import { refreshGovernorCommand } from "../built-in-commands.js";
import { startPoller, isPollerRunning } from "../poller.js";

const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_NO = "approve_no";
const APPROVE_PREFIX = "approve_";
const RECONNECT_YES = "reconnect_yes";
const RECONNECT_NO = "reconnect_no";

/**
 * Send an operator approval prompt for a new session. The prompt shows
 * available color squares as buttons — tapping a color approves AND assigns
 * that color in one action. Returns { approved: true, color } on approval
 * or { approved: false } on denial / timeout.
 */
async function requestApproval(
  chatId: number,
  name: string,
  reconnect = false,
  colorHint?: string,
): Promise<{ approved: boolean; color?: string }> {
  const label = reconnect ? "Session reconnecting:" : "New session requesting access:";
  const text = `🤖 *${label}* ${markdownToV2(name)}\nPick a color to approve, or deny:`;
  const availableColors = getAvailableColors(colorHint);
  const usedColors = new Set(listSessions().map((s) => s.color));
  const validHint = colorHint && (COLOR_PALETTE as readonly string[]).includes(colorHint) ? colorHint : undefined;
  const primaryColor = validHint && !usedColors.has(validHint)
    ? validHint
    : availableColors.find((c) => !usedColors.has(c));
  const colorButtons = availableColors.map((c) => ({
    text: c,
    callback_data: `${APPROVE_PREFIX}${COLOR_PALETTE.indexOf(c as (typeof COLOR_PALETTE)[number])}`,
    ...(c === primaryColor ? { style: "primary" } : {}),
  }));
  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        colorButtons,
        [{ text: "⛔ Deny", callback_data: APPROVAL_NO, style: "danger" }],
      ],
    },
  } as Record<string, unknown>);
  const msgId: number = sent.message_id;

  const decision = await new Promise<{ approved: boolean; color?: string }>((resolve) => {
    const timer = setTimeout(() => {
      clearCallbackHook(msgId);
      resolve({ approved: false });
    }, APPROVAL_TIMEOUT_MS);

    registerCallbackHook(msgId, (evt: TimelineEvent) => {
      clearTimeout(timer);
      const data: string = evt.content.data ?? "";
      const qid = evt.content.qid;
      if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
      if (data === APPROVAL_NO) {
        resolve({ approved: false });
      } else if (data.startsWith(APPROVE_PREFIX)) {
        const idx = parseInt(data.slice(APPROVE_PREFIX.length), 10);
        if (idx >= 0 && idx < COLOR_PALETTE.length) {
          resolve({ approved: true, color: COLOR_PALETTE[idx] });
        } else {
          resolve({ approved: false });
        }
      } else {
        resolve({ approved: false });
      }
    });
  });

  // Delete the prompt on approval (it's private UI — a public broadcast is
  // sent separately). On denial, edit in-place to show the outcome.
  if (decision.approved) {
    await getApi().deleteMessage(chatId, msgId).catch(() => {});
  } else {
    await getApi().editMessageText(
      chatId,
      msgId,
      `🤖 *Session denied:* ${markdownToV2(name)} ✗`,
      { parse_mode: "MarkdownV2" },
    ).catch(() => {});
  }

  return decision;
}

/**
 * Show a simple Approve/Deny dialog for a session reconnect request.
 * Returns true if the operator approves, false on denial or timeout.
 */
async function requestReconnectApproval(chatId: number, name: string): Promise<boolean> {
  const text = `🤖 *Session reconnecting:* ${markdownToV2(name)}\nAuthorize re\\-entry?`;
  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: RECONNECT_YES, style: "primary" },
          { text: "⛔ Deny", callback_data: RECONNECT_NO, style: "danger" },
        ],
      ],
    },
  } as Record<string, unknown>);
  const msgId: number = sent.message_id;

  const approved = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      clearCallbackHook(msgId);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);

    registerCallbackHook(msgId, (evt: TimelineEvent) => {
      clearTimeout(timer);
      const data: string = evt.content.data ?? "";
      const qid = evt.content.qid;
      if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
      resolve(data === RECONNECT_YES);
    });
  });

  if (approved) {
    await getApi().deleteMessage(chatId, msgId).catch(() => {});
  } else {
    await getApi()
      .editMessageText(
        chatId,
        msgId,
        `🤖 *Session reconnect denied:* ${markdownToV2(name)} ✗`,
        { parse_mode: "MarkdownV2", reply_markup: { inline_keyboard: [] } },
      )
      .catch(() => {});
  }

  return approved;
}

const DESCRIPTION =
  "Call once at the start of every session. Creates a session " +
  "with a unique ID and PIN. Fresh sessions auto-drain pending messages; " +
  "reconnects preserve queued messages and return the actual pending count. " +
  "If you lost your PIN (context loss, crash), call with reconnect: true " +
  "and the same name to trigger an operator re-authorization dialog; on " +
  "approval the same SID and PIN are returned. " +
  "Returns { sid, pin, sessions_active, action, pending } so " +
  "the agent knows its identity and how to proceed. " +
  "Call after get_agent_guide and get_me during session setup.";

export function register(server: McpServer) {
  server.registerTool(
    "session_start",
    {
      description: DESCRIPTION,
      inputSchema: {
        name: z
          .string()
          .default("")
          .describe(
            "Human-friendly session name, used as topic prefix. " +
            "Encouraged when multiple sessions are active.",
          ),
        reconnect: z
          .boolean()
          .default(false)
          .describe(
            "Set to true after losing your PIN (context loss, crash, etc.) to request " +
            "operator re-authorization. If a session with the same name already exists, " +
            "shows a simple Approve/Deny dialog; on approval returns the same SID and PIN. " +
            "Also sends 'reconnected' instead of 'joined' messaging on a fresh session start.",
          ),
        color: z
          .string()
          .optional()
          .describe(
            "Preferred color square emoji for this session. " +
            "Palette meanings: 🟦 Coordinator/overseer · 🟩 Builder/worker · 🟨 Reviewer/QA · " +
            "🟧 Research/exploration · 🟥 Ops/deployment · 🟪 Specialist/one-off. " +
            "The operator makes the final choice via the approval dialog color buttons. " +
            "Your hint goes first in the button list as a suggestion.",
          ),
      },
    },
    async ({ name, reconnect, color }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const isFirstSession = activeSessionCount() === 0;

      // Default name for the first session; trim before any validation
      const trimmedName = name.trim();
      const effectiveName = isFirstSession && !trimmedName ? "Primary" : trimmedName;

      // Second+ sessions must provide a name
      if (!isFirstSession && !effectiveName) {
        return toError({
          code: "NAME_REQUIRED",
          message: "A name is required when starting a second or later session.",
        });
      }

      // Names must be alphanumeric (letters, digits, spaces only)
      if (effectiveName && !/^[a-zA-Z0-9 ]+$/.test(effectiveName)) {
        return toError({
          code: "INVALID_NAME",
          message: "Session names must be alphanumeric (letters, digits, spaces only).",
        });
      }

      // Name collision guard: reject if a session with the same name exists
      if (effectiveName) {
        const existing = listSessions().find(
          s => s.name.toLowerCase() === effectiveName.toLowerCase(),
        );
        if (existing) {
          if (reconnect) {
            // Reconnect flow: show simple Approve/Deny dialog (not color-picker)
            const approved = await runInSessionContext(0, () =>
              requestReconnectApproval(chatId, existing.name),
            );
            if (!approved) {
              return toError({
                code: "SESSION_DENIED",
                message: `Session reconnect for "${existing.name}" was denied by the operator.`,
              });
            }
            // Get full session object (listSessions omits PIN)
            const fullSession = getSession(existing.sid);
            if (!fullSession) {
              return toError({
                code: "SESSION_NOT_FOUND",
                message:
                  `Session "${existing.name}" (SID ${existing.sid}) disappeared unexpectedly.`,
              });
            }
            // Reset health markers; preserve queued messages for the reconnecting session
            fullSession.lastPollAt = undefined;
            fullSession.healthy = true;
            const pending = getSessionQueue(existing.sid)?.pendingCount() ?? 0;
            setActiveSession(existing.sid);

            // Deliver service messages
            const allSessions = listSessions();
            const reconSessActive = activeSessionCount();
            if (allSessions.length === 1) {
              deliverServiceMessage(
                existing.sid,
                `Reconnect authorized. You are SID ${existing.sid}. ` +
                  `You are the only active session.`,
                "session_orientation",
                { sid: existing.sid, name: existing.name },
              );
            } else {
              const governorSid = getGovernorSid();
              const governorSession = allSessions.find(s => s.sid === governorSid);
              const governorLabel = governorSession
                ? `'${governorSession.name}' (SID ${governorSid})`
                : `SID ${governorSid}`;
              for (const fellow of allSessions.filter(s => s.sid !== existing.sid)) {
                const isGovernorFellow = fellow.sid === governorSid;
                const governorNote = isGovernorFellow
                  ? "You are the governor — ambiguous messages will be routed to you."
                  : `Ambiguous messages go to ${governorLabel}.`;
                deliverServiceMessage(
                  fellow.sid,
                  `Session '${existing.name}' (SID ${existing.sid}) has reconnected. ` +
                    governorNote,
                  "session_joined",
                  {
                    sid: existing.sid,
                    name: existing.name,
                    governor_sid: governorSid,
                    reconnect: true,
                  },
                );
              }
              const isGovernorReconnect = existing.sid === governorSid;
              const roleNote = isGovernorReconnect
                ? `You are the governor (SID ${existing.sid}). ` +
                  `Ambiguous messages will be routed to you. ` +
                  `Call get_agent_guide for trust and routing guidance.`
                : `You are SID ${existing.sid}. ${governorLabel} is your first escalation ` +
                  `point. Ambiguous messages go to them. ` +
                  `Call get_agent_guide for trust and routing guidance.`;
              deliverServiceMessage(
                existing.sid,
                `Reconnect authorized. Session state preserved. ${roleNote}`,
                "session_orientation",
                { sid: existing.sid, name: existing.name, governor_sid: governorSid },
              );
            }

            void refreshGovernorCommand();
            return toResult({
              sid: fullSession.sid,
              pin: fullSession.pin,
              sessions_active: reconSessActive,
              action: "reconnected",
              pending,
              profile_hint: "Call load_profile(key) to restore saved session configuration.",
              instructions: "You reconnected after a gap. "
                + "Call get_chat_history to check for messages you may have missed. "
                + "Re-save your SID and PIN to session memory if needed.",
            });
          }

          return toError({
            code: "NAME_CONFLICT",
            message:
              `A session named "${existing.name}" already exists (SID ${existing.sid}). ` +
              `If you still have the PIN, resume with dequeue_update(identity: [${existing.sid}, <pin>]). ` +
              `To start a new session, choose a different name. ` +
              `To reclaim this session, call session_start again with reconnect: true.`,
          });
        }
      }

      // Approval gate: second+ sessions require operator approval
      let chosenColor: string | undefined = color;
      if (!isFirstSession) {
        const decision = await runInSessionContext(0, () =>
          requestApproval(chatId, effectiveName, reconnect, color),
        );
        if (!decision.approved) {
          return toError({
            code: "SESSION_DENIED",
            message: `Session "${effectiveName}" was denied by the operator.`,
          });
        }
        chosenColor = decision.color;
      }

      // forceColor = true when the operator explicitly tapped a color button;
      // for the first session (no approval dialog) the agent hint is a suggestion only.
      const session = createSession(effectiveName, chosenColor, !isFirstSession);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);
      if (!isPollerRunning()) startPoller();

      try {
        // Auto-drain any pending messages (always start fresh)
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        const res: Record<string, unknown> = {
          sid: session.sid,
          pin: session.pin,
          sessions_active: session.sessionsActive,
          action: reconnect ? "reconnected" : "fresh",
          pending: 0,
          profile_hint: "Call load_profile(key) to restore saved session configuration.",
          instructions: "IMPORTANT: Save your SID and PIN to session memory NOW. "
            + "You will need them to reconnect after context compaction. "
            + "On reconnect, call get_chat_history to recover any messages missed during the gap.",
        };
        if (discarded > 0) res.discarded = discarded;
        if (isFirstSession) {
          // Send visible announcement with name tag — same format as 2nd+ sessions.
          // buildHeader() intentionally skips single-session mode; compose inline.
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(chatId, `${session.color} 🤖 ${effectiveName}\nSession ${session.sid} — 🟢 Online`),
            ),
          ).catch(() => undefined);
          const announcementMsgId = _announcement?.message_id;
          if (announcementMsgId !== undefined) {
            trackMessageOwner(announcementMsgId, session.sid);
            setSessionAnnouncementMessage(session.sid, announcementMsgId);
            // Do NOT pin yet — defer until a second session joins
          }
          deliverServiceMessage(
            session.sid,
            `You are SID ${session.sid}. You are the only active session.`,
            "session_orientation",
            { sid: session.sid, name: effectiveName, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
          );
        } else if (session.sessionsActive > 1) {
          const allSessions = listSessions();
          res.fellow_sessions = allSessions.filter(s => s.sid !== session.sid);
          if (session.sessionsActive === 2) {
            // Reconnecting sessions take the governor seat (resuming a prior role).
            // Fresh joiners use lowest-SID heuristic (original session is the anchor).
            const governorSid = reconnect
              ? session.sid
              : Math.min(...allSessions.map(s => s.sid));
            setGovernorSid(governorSid);
          }

          // Broadcast a visible announcement via the outbound proxy so the
          // operator (and other sessions) can reply-to-address this session.
          // runInSessionContext sets the ALS SID so the proxy prepends the
          // correct name tag ("🟨 🤖 Worker 1\nSession 2 — 🟢 Online").
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(chatId, `Session ${session.sid} — 🟢 Online`),
            ),
          ).catch(() => undefined);
          const announcementMsgId = _announcement?.message_id;
          if (announcementMsgId !== undefined) {
            trackMessageOwner(announcementMsgId, session.sid);
            setSessionAnnouncementMessage(session.sid, announcementMsgId);
            // When second session joins, retroactively pin the first session's announcement
            if (session.sessionsActive === 2) {
              for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
                const fellowAnnouncement = getSessionAnnouncementMessage(fellow.sid);
                if (fellowAnnouncement !== undefined) {
                  getApi().pinChatMessage(chatId, fellowAnnouncement, { disable_notification: true }).catch(() => {});
                }
              }
            }
            getApi().pinChatMessage(chatId, announcementMsgId, { disable_notification: true }).catch(() => {});
          }

          // Notify existing sessions and the new session of the join event
          const governorSid = getGovernorSid();
          const governorSession = allSessions.find(s => s.sid === governorSid);
          const governorLabel = governorSession ? `'${governorSession.name}' (SID ${governorSid})` : `SID ${governorSid}`;

          const joinVerb = reconnect ? "has reconnected" : "has joined";
          for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
            const isGovernor = fellow.sid === governorSid;
            const governorNote = isGovernor
              ? "You are the governor — ambiguous messages will be routed to you."
              : `Ambiguous messages go to ${governorLabel}.`;
            deliverServiceMessage(
              fellow.sid,
              `Session '${effectiveName}' (SID ${session.sid}) ${joinVerb}. ${governorNote}`,
              "session_joined",
              { sid: session.sid, name: effectiveName, governor_sid: governorSid, reconnect, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
            );
          }

          // Notify the new session of its role
          const newIsGovernor = session.sid === governorSid;
          const roleNote = newIsGovernor
            ? `You are the governor (SID ${session.sid}). Ambiguous messages will be routed to you. Call get_agent_guide for trust and routing guidance.`
            : `You are SID ${session.sid}. ${governorLabel} is your first escalation point. Ambiguous messages go to them. Call get_agent_guide for trust and routing guidance.`;
          deliverServiceMessage(
            session.sid,
            roleNote,
            "session_orientation",
            { sid: session.sid, name: effectiveName, governor_sid: governorSid, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
          );
        }
        void refreshGovernorCommand();
        return toResult(res);
      } catch (err) {
        // Rollback: clean up orphaned session on failure
        removeSessionQueue(session.sid);
        closeSession(session.sid);
        setActiveSession(0);
        return toError(err);
      }
    },
  );
}
