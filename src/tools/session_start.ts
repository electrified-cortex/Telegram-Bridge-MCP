import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { dequeue, pendingCount } from "../message-store.js";
import { createSession, setActiveSession, listSessions } from "../session-manager.js";
import { createSessionQueue } from "../session-queue.js";
import { getRoutingMode } from "../routing-mode.js";
import {
  pollButtonPress,
  ackAndEditSelection,
} from "./button-helpers.js";

const DEFAULT_INTRO = "ℹ️ Session Start";

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

const FRESH_DATA = "session_fresh";
const RESUME_DATA = "session_resume";
const FRESH_LABEL = "Start Fresh";
const RESUME_LABEL = "\u25B6\uFE0F Resume";

/** Wait up to 10 minutes — effectively no timeout. */
const CONFIRM_TIMEOUT_S = 600;

const DESCRIPTION =
  "Call once at the start of every session. Creates a session " +
  "with a unique ID and PIN, sends an intro message, checks " +
  "for pending messages from a previous session, and — if any " +
  "exist — asks the operator whether to resume or start fresh. " +
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
    async ({ intro, name }, { signal }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const session = createSession(name);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);

      try {
        // 1. Send the intro message
        const introText = buildIntro(intro, session.sid, name, session.sessionsActive);
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

        // 2. Check pending count
        const pending = pendingCount();
        if (pending === 0) {
          const res: Record<string, unknown> = {
            sid: session.sid,
            pin: session.pin,
            sessions_active: session.sessionsActive,
            action: "fresh",
            pending: 0,
            intro_message_id: introId,
          };
          if (session.sessionsActive > 1) {
            res.fellow_sessions = listSessions().filter(s => s.sid !== session.sid);
            res.routing_mode = getRoutingMode();
          }
          return toResult(res);
        }

        // 3. Ask the operator
        const plural = pending === 1 ? "message" : "messages";
        const confirmText =
          `${pending} ${plural} from a previous session.`;

        const confirmSent = await getApi().sendMessage(
          chatId,
          markdownToV2(confirmText),
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [[
                { text: FRESH_LABEL, callback_data: FRESH_DATA },
                { text: RESUME_LABEL, callback_data: RESUME_DATA },
              ]],
            },
            _rawText: confirmText,
          } as Record<string, unknown>,
        );

        // 4. Wait for button press
        const result = await pollButtonPress(
          chatId,
          confirmSent.message_id,
          CONFIRM_TIMEOUT_S,
          signal,
        );

        if (!result) {
          // Extremely unlikely (10 min timeout), treat as fresh
          return toResult({
            sid: session.sid,
            pin: session.pin,
            sessions_active: session.sessionsActive,
            action: "fresh",
            discarded: 0,
            intro_message_id: introId,
          });
        }

        const chosenLabel =
          result.data === FRESH_DATA ? FRESH_LABEL : RESUME_LABEL;
        await ackAndEditSelection(
          chatId,
          confirmSent.message_id,
          confirmText,
          chosenLabel,
          result.callback_query_id,
        );

        if (result.data === RESUME_DATA) {
          const res: Record<string, unknown> = {
            sid: session.sid,
            pin: session.pin,
            sessions_active: session.sessionsActive,
            action: "resume",
            pending,
            intro_message_id: introId,
          };
          if (session.sessionsActive > 1) {
            res.fellow_sessions = listSessions().filter(s => s.sid !== session.sid);
            res.routing_mode = getRoutingMode();
          }
          return toResult(res);
        }

        // 5. Drain all pending messages
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        const freshRes: Record<string, unknown> = {
          sid: session.sid,
          pin: session.pin,
          sessions_active: session.sessionsActive,
          action: "fresh",
          discarded,
          intro_message_id: introId,
        };
        if (session.sessionsActive > 1) {
          freshRes.fellow_sessions = listSessions().filter(s => s.sid !== session.sid);
          freshRes.routing_mode = getRoutingMode();
        }
        return toResult(freshRes);
      } catch (err) {
        return toError(err);
      }
    },
  );
}
