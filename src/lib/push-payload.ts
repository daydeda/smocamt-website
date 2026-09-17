// Pure builder for a Web Push notification payload. Kept dependency-free (no
// `db`, no `web-push`) so it can be unit-tested and shared between the send
// path (push.service.ts) and anything that needs to preview a payload.

export interface PushNotificationPayload {
  title: string;
  body: string;
  /** Deep link opened/focused by the service worker's notificationclick handler. */
  url: string;
  /** Collapses repeat notifications of the same logical event (e.g. one per order). */
  tag?: string;
}

const DEFAULT_TITLE = "ActiveCAMT";

/**
 * Serializes a payload for `PushSubscription.send`. Never throws on missing
 * fields — falls back to a generic title rather than sending something the
 * service worker's `push` handler would have to guess at.
 */
export function serializePushPayload(payload: PushNotificationPayload): string {
  return JSON.stringify({
    title: payload.title.trim() || DEFAULT_TITLE,
    body: payload.body.trim(),
    url: payload.url || "/",
    tag: payload.tag,
  });
}
