// Pure classification of a Web Push send failure. Kept dependency-free so it
// can be unit-tested against the documented web-push/WebPushError shape
// without importing the `web-push` package (which does its own network/crypto
// setup at import time) or `db`.

/**
 * 404/410 from the push service means the subscription no longer exists on
 * the browser's end (uninstalled, storage cleared, expired) — the spec's own
 * signal to stop sending to it. Anything else (5xx, network error, a
 * malformed payload) is transient or our own bug, not evidence the
 * subscription is dead.
 */
export function isDeadSubscriptionStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

// After this many consecutive non-dead failures, prune anyway — a
// subscription that never succeeds is as useless as a confirmed-dead one,
// and without a ceiling a permanently misbehaving endpoint accumulates
// failed-send attempts forever.
export const FAILURE_PRUNE_THRESHOLD = 5;

export function shouldPruneAfterFailure(
  statusCode: number | undefined,
  failureCountAfterThisFailure: number,
): boolean {
  return isDeadSubscriptionStatus(statusCode) || failureCountAfterThisFailure >= FAILURE_PRUNE_THRESHOLD;
}
