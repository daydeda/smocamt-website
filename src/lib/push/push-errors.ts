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

// After this many consecutive non-dead failures a subscription becomes a prune
// CANDIDATE. It is only actually removed once it has also gone STALE_AFTER_MS with
// no successful send (or, if it never succeeded, since it was created). Counting
// failures alone deleted working subscriptions after a short outage: Apple/Google
// push errors or a misconfigured VAPID key (e.g. a 403) all look like "failures",
// and iOS cannot renew a dropped subscription by itself, so one bad stretch
// silently switched a phone's notifications off for good.
export const FAILURE_PRUNE_THRESHOLD = 5;
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether to delete a subscription after a failed send.
 * - 404/410: gone on the browser's end, always delete.
 * - anything else: delete only after FAILURE_PRUNE_THRESHOLD consecutive failures
 *   AND no successful send (`lastGoodAt`, falling back to creation time) within
 *   STALE_AFTER_MS.
 */
export function shouldPruneAfterFailure(
  statusCode: number | undefined,
  failureCountAfterThisFailure: number,
  lastGoodAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (isDeadSubscriptionStatus(statusCode)) return true;
  if (failureCountAfterThisFailure < FAILURE_PRUNE_THRESHOLD) return false;
  if (!lastGoodAt) return true;
  return now.getTime() - lastGoodAt.getTime() >= STALE_AFTER_MS;
}
