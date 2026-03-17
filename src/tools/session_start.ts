import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { dequeue } from "../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions } from "../session-manager.js";
import { createSessionQueue, removeSessionQueue } from "../session-queue.js";
import { getRoutingMode } from "../routing-mode.js";
import { sendRoutingPanel } from "../built-in-commands.js";

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

      // Name collision guard: reject if a session with the same name exists
      if (name) {
        const existing = listSessions().find(
          s => s.name.toLowerCase() === name.toLowerCase(),
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

      const session = createSession(name);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);

      try {
        // 1. Send the intro message
        const introText = buildIntro(
          intro, session.sid, name, session.sessionsActive,
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
          res.fellow_sessions = listSessions()
            .filter(s => s.sid !== session.sid);
          res.routing_mode = getRoutingMode();
          if (session.sessionsActive === 2) {
            sendRoutingPanel().catch(() => {});
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
