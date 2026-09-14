import type { ReviewSession } from "./reviewSession";

let refreshHandler: ((session: ReviewSession) => void) | undefined;

export function setMrDiscussionsRefreshHandler(handler: ((session: ReviewSession) => void) | undefined): void {
  refreshHandler = handler;
}

export function requestMrDiscussionsRefresh(session: ReviewSession): void {
  refreshHandler?.(session);
}
