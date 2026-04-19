import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import type { TimelineEvent } from "../message-store.js";
import { dequeue, registerCallbackHook, clearCallbackHook } from "../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions, activeSessionCount, getSession, getAvailableColors, COLOR_PALETTE, setSessionAnnouncementMessage, getSessionAnnouncementMessage, setSessionReauthDialogMsgId, clearSessionReauthDialogMsgId } from "../session-manager.js";
import { createSessionQueue, removeSessionQueue, deliverServiceMessage, trackMessageOwner, deliverReminderEvent, getSessionQueue } from "../session-queue.js";
import { setGovernorSid, getGovernorSid } from "../routing-mode.js";
import { SERVICE_MESSAGES } from "../service-messages.js";
import { runInSessionContext } from "../session-context.js";
import { refreshGovernorCommand } from "../built-in-commands.js";
import { checkAndConsumeAutoApprove } from "../auto-approve.js";
import { startPoller, isPollerRunning } from "../poller.js";
import { fireStartupReminders, buildReminderEvent } from "../reminder-state.js";
import { registerPendingApproval, clearPendingApproval, isDelegationEnabled, setDelegationEnabled } from "../agent-approval.js";
import type { ApprovalDecision } from "../agent-approval.js";

const APPROVAL_TIMEOUT_MS = 120_000;
const APPROVAL_NO = "approve_no";

const APPROVE_PREFIX = "approve_";
const RECONNECT_YES = "reconnect_yes";
const RECONNECT_NO = "reconnect_no";
const TOGGLE_DELEGATION = "approve_toggle_delegation";

/**
 * Build the inline keyboard for the approval dialog.
 * Always 3 rows: [colors row1], [colors row2], [delegation toggle, deny].
 */
function buildApprovalKeyboard(
  availableColors: string[],
  colorHint: string | undefined,
  delegationEnabled: boolean,
): { inline_keyboard: Record<string, unknown>[][] } {
  const validHint =
    colorHint && COLOR_PALETTE.includes(colorHint as (typeof COLOR_PALETTE)[number])
      ? colorHint
      : undefined;
  const colorButtons = availableColors.map((c, i) => {
    let isPrimary = false;
    if (validHint) {
      isPrimary = c === validHint;
    } else if (delegationEnabled) {
      isPrimary = i === 0;
    }
    return {
      text: c,
      callback_data: `${APPROVE_PREFIX}${COLOR_PALETTE.indexOf(c as (typeof COLOR_PALETTE)[number])}`,
      ...(isPrimary ? { style: "primary" } : {}),
    } as Record<string, unknown>;
  });
  const row1 = colorButtons.slice(0, 3);
  const row2 = colorButtons.slice(3);
  const toggleButton: Record<string, unknown> = delegationEnabled
    ? { text: "✅ Delegated", callback_data: TOGGLE_DELEGATION }
    : { text: "☐ Delegate", callback_data: TOGGLE_DELEGATION };
  const denyButton: Record<string, unknown> = { text: "⛔ Deny", callback_data: APPROVAL_NO, style: "danger" };
  return { inline_keyboard: [row1, row2, [toggleButton, denyButton]] };
}

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
): Promise<{ approved: boolean; color?: string; forceColor?: boolean }> {
  const label = reconnect ? "Session reconnecting:" : "New session requesting access:";
  const reconnectHint = reconnect ? `\nThe agent may have a saved token — approve only if token recovery failed\\.` : "";
  const text = `🤖 *${label}* ${markdownToV2(name)}\nPick a color to approve, or deny:${reconnectHint}`;
  const availableColors = getAvailableColors(colorHint);
  if (checkAndConsumeAutoApprove()) {
    return { approved: true, color: colorHint ?? availableColors[0], forceColor: true };
  }
  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: buildApprovalKeyboard(availableColors, colorHint, isDelegationEnabled()),
  } as Record<string, unknown>);
  const msgId: number = sent.message_id;

  const decision = await new Promise<ApprovalDecision>((resolve) => {
    let resolved = false;
    const resolveOnce = (value: ApprovalDecision) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearCallbackHook(msgId);
      resolve(value);
    };
    const ticket = registerPendingApproval(name, resolveOnce, colorHint);
    const timer = setTimeout(() => {
      clearPendingApproval(ticket);
      resolveOnce({ approved: false });
    }, APPROVAL_TIMEOUT_MS);

    // Notify governor of pending approval
    const governorSid = getGovernorSid();
    if (governorSid) {
      deliverServiceMessage(
        governorSid,
        `Session "${name}" is requesting access. Ticket: ${ticket}\nHint: action(type: 'approve', token: <your_token>, ticket: ${ticket})`,
        "pending_approval",
        { name, ticket },
      );
    }

    const handler = (evt: TimelineEvent) => {
      const data: string = evt.content.data ?? "";
      const qid = evt.content.qid;
      if (data === TOGGLE_DELEGATION) {
        // Re-register hook for next click (one-shot: must re-register after each fire)
        registerCallbackHook(msgId, handler);
        setDelegationEnabled(!isDelegationEnabled());
        getApi()
          .editMessageReplyMarkup(chatId, msgId, {
            reply_markup: buildApprovalKeyboard(availableColors, colorHint, isDelegationEnabled()),
          } as Record<string, unknown>)
          .catch(() => {});
        if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
        return;
      }
      clearPendingApproval(ticket);
      if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
      if (data === APPROVAL_NO) {
        resolveOnce({ approved: false });
      } else if (data.startsWith(APPROVE_PREFIX)) {
        const idx = parseInt(data.slice(APPROVE_PREFIX.length), 10);
        if (idx >= 0 && idx < COLOR_PALETTE.length) {
          resolveOnce({ approved: true, color: COLOR_PALETTE[idx], forceColor: true });
        } else {
          resolveOnce({ approved: false });
        }
      } else {
        resolveOnce({ approved: false });
      }
    };
    registerCallbackHook(msgId, handler);
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
async function requestReconnectApproval(chatId: number, name: string, sid: number): Promise<boolean> {
  if (checkAndConsumeAutoApprove()) return true;
  const text = `🤖 *Session reconnecting:* ${markdownToV2(name)}`;
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
  setSessionReauthDialogMsgId(sid, msgId);

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
    clearSessionReauthDialogMsgId(sid);  // clear first, prevent double-delete race
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
    clearSessionReauthDialogMsgId(sid);
  }

  return approved;
}

const DESCRIPTION =
  "Call once at the start of every session. Creates a fresh session " +
  "with a unique ID and token. Fresh sessions auto-drain pending messages. " +
  "If you lost your token (context loss, crash), use action(type: 'session/reconnect', ...) instead. " +
  "Returns { token, sid, suffix, sessions_active, action, pending } so " +
  "you have the token and context without extra steps. " +
  "Call help() first to load the API guide, then call action(type: 'session/start', ...) to join.";

export async function handleSessionStart({ name, color }: { name: string; color?: string }) {
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
          message: "A name is required when starting a second or later session. Pass name: \"<YourName>\" to action(type: 'session/start', ...).",
        });
      }

      // Names must be alphanumeric (letters, digits, spaces only)
      if (effectiveName && !/^[a-zA-Z0-9 ]+$/.test(effectiveName)) {
        return toError({
          code: "INVALID_NAME",
          message: `Session name "${effectiveName}" contains invalid characters. Use letters, digits, and spaces only.`,
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
              `Session '${existing.name}' already exists (SID ${existing.sid}). ` +
              `You are already online. Find your token in session memory and call dequeue(token: <token>). That's it. If token recovery fails, call action(type: 'session/reconnect', name: '<name>') as a last resort.`,
          });
        }
      }

      // Approval gate: second+ sessions require operator approval
      let chosenColor: string | undefined = color;
      let decision: { approved: boolean; color?: string; forceColor?: boolean } | undefined;
      if (!isFirstSession) {
        decision = await runInSessionContext(0, () =>
          requestApproval(chatId, effectiveName, false, color),
        );
        if (!decision.approved) {
          return toError({
            code: "SESSION_DENIED",
            message: `Session "${effectiveName}" was denied by the operator.`,
          });
        }
        chosenColor = decision.color;
      }

      // forceColor = true when the operator explicitly tapped a color button, or on auto-approve (hint is definitive);
      // forceColor = false for the first session (no dialog, no hint).
      const session = createSession(effectiveName, chosenColor, decision?.forceColor ?? !isFirstSession);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);
      if (!isPollerRunning()) startPoller();

      try {
        // Auto-drain any pending messages (always start fresh)
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        const sessionToken = session.sid * 1_000_000 + session.suffix;
        const res: Record<string, unknown> = {
          token: sessionToken,
          sid: session.sid,
          suffix: session.suffix,
          sessions_active: session.sessionsActive,
          action: "fresh",
          pending: 0,
          discarded,
          fellow_sessions: [] as unknown[],
        };
        if (isFirstSession) {
          // First session is the governor by default
          setGovernorSid(session.sid);
          // Send visible announcement with name tag — same format as 2nd+ sessions.
          // buildHeader() intentionally skips single-session mode; compose inline.
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(chatId, `${session.color} 🤖 \`${markdownToV2(effectiveName)}\`\nSession ${session.sid} — 🟢 Online`, { parse_mode: "MarkdownV2" }),
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
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.text, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.eventType);
          // First session is always governor — no ternary needed.
          deliverServiceMessage(
            session.sid,
            SERVICE_MESSAGES.ONBOARDING_ROLE_GOVERNOR.text,
            SERVICE_MESSAGES.ONBOARDING_ROLE_GOVERNOR.eventType,
          );
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_PROTOCOL.text, SERVICE_MESSAGES.ONBOARDING_PROTOCOL.eventType);
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT.text, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT.eventType);
        } else if (session.sessionsActive > 1) {
          const allSessions = listSessions();
          res.fellow_sessions = allSessions.filter(s => s.sid !== session.sid);
          if (session.sessionsActive === 2) {
            // Fresh joiners use lowest-SID heuristic (original session is the anchor).
            const governorSid = Math.min(...allSessions.map(s => s.sid));
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

          for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
            const isGovernor = fellow.sid === governorSid;
            const text = isGovernor
              ? SERVICE_MESSAGES.SESSION_JOINED.text(effectiveName, session.sid)
              : `${effectiveName} (SID ${session.sid}) joined. Ambiguous messages go to ${governorLabel}.`;
            deliverServiceMessage(
              fellow.sid,
              text,
              SERVICE_MESSAGES.SESSION_JOINED.eventType,
              { sid: session.sid, name: effectiveName, governor_sid: governorSid, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
            );
          }

          // Notify the new session of its role
          const newIsGovernor = session.sid === governorSid;
          const roleNote = newIsGovernor
            ? `You are the governor (SID ${session.sid}). Ambiguous messages will be routed to you. Call help(topic: 'guide') for trust and routing guidance.`
            : `You are SID ${session.sid}. ${governorLabel} is your first escalation point. Ambiguous messages go to them. Call help(topic: 'guide') for trust and routing guidance.`;
          deliverServiceMessage(
            session.sid,
            roleNote,
            "session_orientation",
            { sid: session.sid, name: effectiveName, governor_sid: governorSid, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
          );
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.text, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.eventType);
          // session_orientation already carries role info (governor vs participant) for multi-session.
          // Skip onboarding_role here to avoid duplication.
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_PROTOCOL.text, SERVICE_MESSAGES.ONBOARDING_PROTOCOL.eventType);
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT.text, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT.eventType);
        }
        void refreshGovernorCommand();

        // Fire startup reminders for the new session
        const startupFired = runInSessionContext(session.sid, () => fireStartupReminders(session.sid));
        for (const r of startupFired) {
          deliverReminderEvent(session.sid, buildReminderEvent(r));
        }

        return toResult(res);
      } catch (err) {
        // Rollback: clean up orphaned session on failure
        removeSessionQueue(session.sid);
        closeSession(session.sid);
        setActiveSession(0);
        return toError(err);
      }
}

export async function handleSessionReconnect({ name }: { name: string }) {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const trimmedName = name.trim();
  if (!trimmedName) {
    return toError({
      code: "NAME_REQUIRED",
      message: "A session name is required for reconnect. Pass the name of the session you wish to reclaim.",
    });
  }

  const existing = listSessions().find(
    s => s.name.toLowerCase() === trimmedName.toLowerCase(),
  );

  if (!existing) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `No active session named "${trimmedName}" found. If your session closed, start a new one with action(type: 'session/start', ...).`,
    });
  }

  // Get full session object (listSessions omits token suffix)
  const fullSession = getSession(existing.sid);
  if (!fullSession) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message:
        `Session "${existing.name}" (SID ${existing.sid}) closed before reconnect completed. ` +
        `Call action(type: 'session/start', ...) with a fresh name to create a new session.`,
    });
  }

  // Reconnect flow: show the simple Approve/Deny dialog.
  const approved = await runInSessionContext(0, () =>
    requestReconnectApproval(chatId, existing.name, existing.sid),
  );
  if (!approved) {
    return toError({
      code: "SESSION_DENIED",
      message: `Session reconnect for "${existing.name}" was denied by the operator. Check memory for a previously saved token — if found, use that token directly without calling action(type: 'session/reconnect', ...) again.`,
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
      const text = isGovernorFellow
        ? SERVICE_MESSAGES.SESSION_JOINED.text(existing.name, existing.sid) + " (reconnected)"
        : `${existing.name} (SID ${existing.sid}) reconnected. Ambiguous messages go to ${governorLabel}.`;
      deliverServiceMessage(
        fellow.sid,
        text,
        SERVICE_MESSAGES.SESSION_JOINED.eventType,
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
        `Call help(topic: 'guide') for trust and routing guidance.`
      : `You are SID ${existing.sid}. ${governorLabel} is your first escalation ` +
        `point. Ambiguous messages go to them. ` +
        `Call help(topic: 'guide') for trust and routing guidance.`;
    deliverServiceMessage(
      existing.sid,
      `Reconnect authorized. Session state preserved. ${roleNote}`,
      "session_orientation",
      { sid: existing.sid, name: existing.name, governor_sid: governorSid },
    );
  }

  void refreshGovernorCommand();

  // Fire startup reminders for the reconnecting session
  const reconStartupFired = runInSessionContext(existing.sid, () => fireStartupReminders(existing.sid));
  for (const r of reconStartupFired) {
    deliverReminderEvent(existing.sid, buildReminderEvent(r));
  }

  const reconToken = fullSession.sid * 1_000_000 + fullSession.suffix;
  return toResult({
    token: reconToken,
    sid: fullSession.sid,
    sessions_active: reconSessActive,
    action: "reconnected",
    pending,
  });
}

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
    handleSessionStart,
  );
}
