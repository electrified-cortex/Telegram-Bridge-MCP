import type { NotifySource } from "./activity/file-state.js";
import { notifyIfAllowed } from "./activity/file-state.js";
import { notifySseSubscriber } from "../sse-endpoint.js";

export function notifySession(
  sid: number,
  source: NotifySource,
  inflightAtEnqueue: boolean,
): void {
  if (notifyIfAllowed(sid, source, inflightAtEnqueue)) {
    notifySseSubscriber(sid);
  }
}
