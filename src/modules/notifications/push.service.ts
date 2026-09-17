import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { serializePushPayload, type PushNotificationPayload } from "@/lib/push-payload";
import { shouldPruneAfterFailure } from "@/lib/push-errors";

// How many sends run concurrently per fan-out. Uncapped Promise.all over
// hundreds of subscriptions would open that many simultaneous HTTPS
// connections to the push services (FCM/Mozilla/Apple) at once; this keeps
// a broadcast (e.g. an announcement) well-behaved without needing queue infra.
const SEND_CONCURRENCY = 20;

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID keys are not configured — push notifications are disabled");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class PushService {
  static isConfigured(): boolean {
    return !!(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
    );
  }

  /**
   * Upserts on `endpoint` (globally unique — see schema.ts comment), not on
   * (userId, endpoint). A shared device re-subscribing under a different
   * account must transfer the row to the new user, not create a stale
   * duplicate that keeps notifying whoever subscribed first.
   */
  static async saveSubscription(userId: string, sub: SubscriptionInput, userAgent: string | null) {
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          userAgent,
          failureCount: 0,
        },
      });
  }

  static async removeSubscription(endpoint: string) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  /** Scoped delete for the client-initiated sign-out unsubscribe — a user may
   * only remove their OWN device's subscription, never guess-delete another's. */
  static async removeSubscriptionForUser(userId: string, endpoint: string) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
  }

  /** Send to every device belonging to each of these users. Never throws — a
   * dead/broken device must never fail the write path that triggered it. */
  static async sendToUserIds(userIds: string[], payload: PushNotificationPayload): Promise<void> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return;
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, uniqueIds));
    await PushService.sendToSubscriptionRows(subs, payload);
  }

  /** Broadcast to every stored subscription (announcements). */
  static async sendToAll(payload: PushNotificationPayload): Promise<void> {
    const subs = await db.select().from(pushSubscriptions);
    await PushService.sendToSubscriptionRows(subs, payload);
  }

  private static async sendToSubscriptionRows(
    subs: (typeof pushSubscriptions.$inferSelect)[],
    payload: PushNotificationPayload,
  ): Promise<void> {
    if (subs.length === 0) return;
    try {
      ensureVapidConfigured();
    } catch (error) {
      console.error("Push send skipped:", error);
      return;
    }

    const body = serializePushPayload(payload);
    let i = 0;
    async function worker() {
      while (i < subs.length) {
        const sub = subs[i++];
        await PushService.sendOne(sub, body);
      }
    }
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, subs.length) }, worker));
  }

  private static async sendOne(sub: typeof pushSubscriptions.$inferSelect, body: string): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failureCount: 0 })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (error) {
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      const newFailureCount = sub.failureCount + 1;
      if (shouldPruneAfterFailure(statusCode, newFailureCount)) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      } else {
        await db
          .update(pushSubscriptions)
          .set({ failureCount: newFailureCount })
          .where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }
}
