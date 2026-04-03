/**
 * Governor health-check timer.
 *
 * Runs every CHECK_INTERVAL_MS (default 60 s) and inspects all active sessions.
 * - Sessions with no tool activity within HEALTH_THRESHOLD_MS are treated as unresponsive.
 *   Any authenticated tool call resets the timer via touchSession() in requireAuth().
 * - If the governor is unresponsive the operator receives a three-option prompt to
 *   reroute, promote, or wait.
 * - Non-governor unresponsive sessions produce a notification only.
 * - When an unhealthy session polls again (touchSession sets healthy=true) the health
 *   check detects the recovery and notifies the operator.
 */

import type { TimelineEvent } from "./message-store.js";
import { registerCallbackHook, clearCallbackHook } from "./message-store.js";
import {
  getSession,
  listSessions,
  markUnhealthy,
  getUnhealthySessions,
} from "./session-manager.js";
import { getGovernorSid, setGovernorSid } from "./routing-mode.js";
import { deliverDirectMessage, deliverServiceMessage } from "./session-queue.js";
import { getApi, getRawApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { markdownToV2 } from "./markdown.js";
import { dlog } from "./debug-log.js";
import { hasActiveAnimation } from "./animation-state.js";
import { getCallerSid } from "./session-context.js";
import { registerOnceOnSend, clearOnceOnSend } from "./outbound-proxy.js";

// ── Constants ──────────────────────────────────────────────

/** Default check interval in milliseconds. */
export const CHECK_INTERVAL_MS = 60_000;

/**
 * How long a session can go without any tool activity before it is considered
 * unhealthy. Set to 15 minutes to allow room for long-running local operations.
 */
export const HEALTH_THRESHOLD_MS = 900_000;

const CB_REROUTE_NOW  = "hc_reroute_now";
const CB_MAKE_PRIMARY = "hc_make_primary";
const CB_WAIT         = "hc_wait";

// ── Module state ──────────────────────────────────────────

/** SIDs of sessions that have already been flagged to the operator. */
const _flaggedSids = new Set<number>();

/** message_id of the "unresponsive" warning posted for each session (SID → message_id). */
const _unresponsiveMsgIds = new Map<number, number>();

/** message_id of the "back online" message posted for each session (SID → message_id). */
const _backOnlineMsgIds = new Map<number, number>();

let _intervalHandle: ReturnType<typeof setInterval> | undefined;
let _isRunning = false;

// ── Internal helpers ──────────────────────────────────────

/** Return the lowest-SID session that is not `excludeSid`, or undefined. */
function findNextSession(excludeSid: number) {
  return listSessions().find(s => s.sid !== excludeSid);
}

/**
 * Send the three-option governor-timeout prompt to the operator.
 * Registers a callback hook so the response is handled asynchronously.
 */
async function sendGovernorPrompt(
  governorSid: number,
  governorName: string,
  nextSid: number,
  nextName: string,
): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;

  // Capture the active session SID before the async send so the callback hook
  // runs in the same session context, keeping the name-tag consistent on edit.
  // getCallerSid() returns 0 when there is no ALS context (e.g. a timer callback);
  // registerCallbackHook only stores ownerSid when > 0, so pass undefined in that case.
  const hookOwnerSid = getCallerSid();

  const text =
    `⚠️ *${markdownToV2(governorName)}* \\(primary\\) appears unresponsive\\.\n` +
    `Next available session: *${markdownToV2(nextName)}*`;

  const keyboard = [
    [{ text: `⇄ Reroute to ${nextName}`,    callback_data: `${CB_REROUTE_NOW}:${nextSid}`  }],
    [{ text: `↑ Make ${nextName} primary`,   callback_data: `${CB_MAKE_PRIMARY}:${nextSid}` }],
    [{ text: `⏳ Wait for ${governorName}`,  callback_data: CB_WAIT                         }],
  ];

  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: keyboard },
  } as Record<string, unknown>);

  const msgId = sent.message_id;

  registerCallbackHook(msgId, (evt: TimelineEvent) => {
    clearCallbackHook(msgId);

    const data = evt.content.data ?? "";
    const qid  = evt.content.qid;
    if (qid) getApi().answerCallbackQuery(qid).catch(() => {});

    if (data === CB_WAIT) {
      void getApi().editMessageText(chatId, msgId,
        `⏳ Waiting for ${governorName} to come back\\.`,
        { parse_mode: "MarkdownV2" },
      ).catch(() => {});
      return;
    }

    // Both reroute-now and make-primary resolve to the same action in the
    // current architecture: set the specified session as the new governor.
    const colonIdx = data.indexOf(":");
    if (colonIdx === -1) return;
    const targetSidStr = data.slice(colonIdx + 1);
    const targetSid = parseInt(targetSidStr, 10);
    if (isNaN(targetSid) || targetSid <= 0) return;

    setGovernorSid(targetSid);

    const targetSession = getSession(targetSid);
    const targetName = targetSession?.name ?? `Session ${targetSid}`;

    deliverDirectMessage(
      0,
      targetSid,
      `↑ You are now the primary session. Ambiguous messages will be routed to you.`,
    );

    // Notify all other active sessions that the governor has changed
    for (const s of listSessions()) {
      if (s.sid === targetSid) continue; // already notified via DM above
      deliverServiceMessage(
        s.sid,
        `Governor switched: '${targetName}' (SID ${targetSid}) is now the primary session.`,
        "governor_changed",
        { new_governor_sid: targetSid, new_governor_name: targetName },
      );
    }

    const verb = data.startsWith(CB_MAKE_PRIMARY) ? "primary session" : "rerouted to";
    void getApi().editMessageText(
      chatId, msgId,
      `✓ *${markdownToV2(targetName)}* is now the ${verb === "primary session" ? "primary session" : `target for new messages`}\\.`,
      { parse_mode: "MarkdownV2" },
    ).catch(() => {});

    dlog("health", `governor rerouted: new governor sid=${targetSid} name=${targetName}`);
  }, hookOwnerSid > 0 ? hookOwnerSid : undefined);
}

// ── Health check tick ─────────────────────────────────────

async function runHealthCheck(thresholdMs: number): Promise<void> {
  if (_isRunning) return;
  _isRunning = true;
  try {
    const unhealthy = getUnhealthySessions(thresholdMs);
    const unhealthySids = new Set(unhealthy.map(s => s.sid));
    const governorSid   = getGovernorSid();

    // ── Recovery detection ──────────────────────────────
    for (const sid of [..._flaggedSids]) {
      if (unhealthySids.has(sid)) continue; // still unresponsive
      // Session has polled again — it's healthy again.
      _flaggedSids.delete(sid);
      const session = getSession(sid);
      const name = session?.name ?? `Session ${sid}`;

      // Delete the "unresponsive" warning if we tracked its message_id
      const warningMsgId = _unresponsiveMsgIds.get(sid);
      _unresponsiveMsgIds.delete(sid);
      if (warningMsgId !== undefined) {
        const chatId = resolveChat();
        if (typeof chatId === "number") {
          void getRawApi().deleteMessage(chatId, warningMsgId).catch(() => {});
        }
      }

      // Evict any previous "back online" message + hook before registering new ones.
      // If a session recovered but never sent an outbound message (so the one-shot hook
      // never fired), and then went unhealthy and recovered again — the old message_id
      // would be lost. Delete it now to prevent orphaned messages.
      const prevBackOnlineMsgId = _backOnlineMsgIds.get(sid);
      if (prevBackOnlineMsgId !== undefined) {
        _backOnlineMsgIds.delete(sid);
        clearOnceOnSend(sid);
        const chatId = resolveChat();
        if (typeof chatId === "number") {
          void getRawApi().deleteMessage(chatId, prevBackOnlineMsgId).catch(() => {});
        }
      }

      // Post "back online" and track its message_id for later deletion
      const backOnlineMsgId = await sendServiceMessage(`✅ ${name} is back online.`).catch(() => undefined);
      if (backOnlineMsgId !== undefined) {
        _backOnlineMsgIds.set(sid, backOnlineMsgId);
        // Delete "back online" on the session's first real outbound send
        registerOnceOnSend(sid, () => {
          const msgId = _backOnlineMsgIds.get(sid);
          _backOnlineMsgIds.delete(sid);
          if (msgId !== undefined) {
            const chatId = resolveChat();
            if (typeof chatId === "number") {
              void getRawApi().deleteMessage(chatId, msgId).catch(() => {});
            }
          }
        });
      }

      dlog("health", `session recovered sid=${sid} name=${name}`);
    }

    // ── Newly unhealthy sessions ────────────────────────
    for (const session of unhealthy) {
      if (_flaggedSids.has(session.sid)) continue; // already handled
      if (hasActiveAnimation(session.sid)) continue; // animation = proof of life
      _flaggedSids.add(session.sid);
      markUnhealthy(session.sid);
      dlog("health", `session unhealthy sid=${session.sid} name=${session.name}`);

      const isGovernor = session.sid === governorSid && governorSid > 0;

      if (isGovernor) {
        const next = findNextSession(session.sid);
        if (next) {
          await sendGovernorPrompt(session.sid, session.name, next.sid, next.name).catch((e: unknown) => {
            process.stderr.write(`[health-check] prompt error: ${String(e)}\n`);
          });
        } else {
          const msgId = await sendServiceMessage(
            `⚠️ ${session.name} (primary) appears unresponsive and no other session is available.`,
          ).catch(() => undefined);
          if (msgId !== undefined) _unresponsiveMsgIds.set(session.sid, msgId);
        }
      } else {
        const msgId = await sendServiceMessage(
          `⚠️ ${session.name} appears unresponsive.`,
        ).catch(() => undefined);
        if (msgId !== undefined) _unresponsiveMsgIds.set(session.sid, msgId);
      }
    }
  } finally {
    _isRunning = false;
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * Start the periodic health check.
 * Safe to call multiple times — a second call replaces the existing timer.
 */
export function startHealthCheck(
  intervalMs  = CHECK_INTERVAL_MS,
  thresholdMs = HEALTH_THRESHOLD_MS,
): void {
  stopHealthCheck();
  _intervalHandle = setInterval(() => {
    void runHealthCheck(thresholdMs);
  }, intervalMs);
}

/** Stop the health check timer and clear all flagged-session state. */
export function stopHealthCheck(): void {
  if (_intervalHandle !== undefined) {
    clearInterval(_intervalHandle);
    _intervalHandle = undefined;
  }
  _flaggedSids.clear();
  _unresponsiveMsgIds.clear();
  _backOnlineMsgIds.clear();
  _isRunning = false;
  clearOnceOnSend();
}

/** Exposed for tests — directly run one health check tick. */
export function _runHealthCheckNow(thresholdMs = HEALTH_THRESHOLD_MS): Promise<void> {
  return runHealthCheck(thresholdMs);
}
