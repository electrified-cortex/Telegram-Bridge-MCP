import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import type { TimelineEvent } from "../message-store.js";
import { dequeue, registerCallbackHook, clearCallbackHook } from "../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions, activeSessionCount } from "../session-manager.js";
import { createSessionQueue, removeSessionQueue } from "../session-queue.js";
import { setGovernorSid } from "../routing-mode.js";
import { grantDm } from "../dm-permissions.js";

const DEFAULT_INTRO = "ℹ️ Session Start";
const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_YES = "approve_yes";
const APPROVAL_NO = "approve_no";

/**
 * Send an operator approval prompt for a new session and wait up to
 * APPROVAL_TIMEOUT_MS for a button press. Returns true if approved, false
 * if denied or timed out.
 */
async function requestApproval(
  chatId: number,
  name: string,
): Promise<boolean> {
  const text = `🤖 *New session requesting access:* ${markdownToV2(name)}`;
  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [[
        { text: "✓ Approve", callback_data: APPROVAL_YES, style: "success" },
        { text: "✗ Deny",    callback_data: APPROVAL_NO,  style: "danger"  },
      ]],
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
      const approved = evt.content.data === APPROVAL_YES;
      // Ack the Telegram button spinner
      const qid = evt.content.qid;
      if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
      resolve(approved);
    });
  });

  // Edit the prompt to reflect the outcome (clears the inline keyboard)
  await getApi().editMessageText(
    chatId,
    msgId,
    `🤖 *Session request:* ${markdownToV2(name)} — ${approved ? "approved ✓" : "denied ✗"}`,
    { parse_mode: "MarkdownV2" },
  ).catch(() => {});

  return approved;
}

/** Build the actual intro text, injecting session identity. */
function buildIntro(
  template: string,
  sid: number,
  name: string,
  sessionsActive: number,
): string {
  const tag = name ? `Session ${sid} — ${name}` : `Session ${sid}`;
  // When multiple sessions are active (or this one has a name), always show identity
  if (sessionsActive > 1 || name) {
    return template === DEFAULT_INTRO
      ? `ℹ️ ${tag}`
      : `${template}\n_${tag}_`;
  }
  return template;
}

const DESCRIPTION =
  "Call once at the start of every session. Creates a session " +
  "with a unique ID and PIN, sends an intro message, and " +
  "auto-drains any pending messages from a previous session. " +
  "Returns { sid, pin, sessions_active, action, pending } so " +
  "the agent knows its identity and how to proceed. " +
  "Call after get_agent_guide and get_me during session setup.";

export function register(server: McpServer) {
  server.registerTool(
    "session_start",
    {
      description: DESCRIPTION,
      inputSchema: {
        intro: z
          .string()
          .default(DEFAULT_INTRO)
          .describe(
            "Markdown text for the intro message. " +
            "Defaults to \"ℹ️ Session Start\".",
          ),
        name: z
          .string()
          .default("")
          .describe(
            "Human-friendly session name, used as topic prefix. " +
            "Encouraged when multiple sessions are active.",
          ),
      },
    },
    async ({ intro, name }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const isFirstSession = activeSessionCount() === 0;

      // Default name for the first session
      const effectiveName = isFirstSession && !name ? "Primary" : name;

      // Second+ sessions must provide a name
      if (!isFirstSession && !effectiveName) {
        return toError({
          code: "NAME_REQUIRED",
          message: "A name is required when starting a second or later session.",
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
      if (!isFirstSession) {
        const approved = await requestApproval(chatId, effectiveName);
        if (!approved) {
          return toError({
            code: "SESSION_DENIED",
            message: `Session "${effectiveName}" was denied by the operator.`,
          });
        }
      }

      const session = createSession(effectiveName);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);

      // Auto-grant bidirectional DM between new session and all existing sessions.
      // Operator approval is the trust gate — no extra request_dm_access needed.
      if (!isFirstSession) {
        for (const fellow of listSessions().filter(s => s.sid !== session.sid)) {
          grantDm(session.sid, fellow.sid);
          grantDm(fellow.sid, session.sid);
        }
      }

      try {
        // 1. Send the intro message
        const introText = buildIntro(
          intro, session.sid, effectiveName, session.sessionsActive,
        );
        const sent = await getApi().sendMessage(
          chatId,
          markdownToV2(introText),
          {
            parse_mode: "MarkdownV2",
            disable_notification: true,
            _rawText: introText,
          } as Record<string, unknown>,
        );
        const introId: number = sent.message_id;

        // 2. Auto-drain any pending messages (always start fresh)
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        const res: Record<string, unknown> = {
          sid: session.sid,
          pin: session.pin,
          sessions_active: session.sessionsActive,
          action: "fresh",
          pending: 0,
          intro_message_id: introId,
        };
        if (discarded > 0) res.discarded = discarded;
        if (session.sessionsActive > 1) {
          const allSessions = listSessions();
          res.fellow_sessions = allSessions.filter(s => s.sid !== session.sid);
          if (session.sessionsActive === 2) {
            // Auto-activate governor: lowest-SID session (the first one) becomes governor
            const lowestSid = Math.min(...allSessions.map(s => s.sid));
            setGovernorSid(lowestSid);
          }
        }
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
