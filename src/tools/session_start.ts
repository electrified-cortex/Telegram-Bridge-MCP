import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import type { TimelineEvent } from "../message-store.js";
import { dequeue, registerCallbackHook, clearCallbackHook } from "../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions, activeSessionCount, getAvailableColors, COLOR_PALETTE, setSessionAnnouncementMessage } from "../session-manager.js";
import { createSessionQueue, removeSessionQueue, deliverServiceMessage, trackMessageOwner } from "../session-queue.js";
import { setGovernorSid, getGovernorSid } from "../routing-mode.js";
import { runInSessionContext } from "../session-context.js";
import { refreshGovernorCommand } from "../built-in-commands.js";

const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_NO = "approve_no";
const APPROVE_PREFIX = "approve_";

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
  const colorButtons = availableColors.map((c) => ({
    text: c,
    callback_data: `${APPROVE_PREFIX}${COLOR_PALETTE.indexOf(c as (typeof COLOR_PALETTE)[number])}`,
    ...(c === colorHint ? { style: "primary" } : {}),
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

const DESCRIPTION =
  "Call once at the start of every session. Creates a session " +
  "with a unique ID and PIN, and auto-drains any pending messages " +
  "from a previous session. " +
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
            "Set to true when reconnecting after a server restart. " +
            "Sends 'reconnected' messaging instead of 'joined' to the operator and fellow sessions.",
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
          return toError({
            code: "NAME_CONFLICT",
            message:
              `A session named "${existing.name}" already exists (SID ${existing.sid}). ` +
              `Choose a different name, or resume your existing session with dequeue_update(sid=${existing.sid}).`,
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

      const session = createSession(effectiveName, chosenColor);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);

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
        };
        if (discarded > 0) res.discarded = discarded;
        if (isFirstSession) {
          // Send visible announcement — same format as 2nd+ sessions so the
          // operator knows a session is online even for the auto-approved first session.
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(chatId, `Session ${session.sid} — 🟢 Online`),
            ),
          ).catch(() => undefined);
          const announcementMsgId = _announcement?.message_id;
          if (announcementMsgId !== undefined) {
            trackMessageOwner(announcementMsgId, session.sid);
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
            // Auto-activate governor: lowest-SID session (the first one) becomes governor
            const lowestSid = Math.min(...allSessions.map(s => s.sid));
            setGovernorSid(lowestSid);
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
