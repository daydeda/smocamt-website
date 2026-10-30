import { db } from "@/db";
import { auditLogs, events } from "@/db/schema";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { eventReminderPayload, isOpenToStudents, newEventPayload, repushWaitMs } from "@/lib/push/reminders";
import { AuditService } from "@/modules/audit/audit.service";
import type { EligibilityItem } from "@/lib/access/event-access";
import { PushService } from "./push.service";
import { getNewEventAudienceUserIds } from "./push-audience";

/** Eligibility columns of an event as they are now, to hand to announceNewEventIfOpen after an edit. */
export async function snapshotEventEligibility(eventId: string): Promise<EligibilityItem | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  return event ?? null;
}

/**
 * Sends the "new event" push once, the first time an event is open to students.
 * Called after an event is created or edited. An event hidden from students (for
 * example SMO-only) stays unannounced until it is opened; the claim on
 * events.new_event_pushed_at makes that happen exactly once, even across racing edits.
 * If the event was already announced and `before` (its eligibility prior to this edit) is given,
 * an edit that widens who may join (e.g. removing a 1st-year lock) pushes only the newly eligible
 * users, so they are not missed and nobody is notified twice.
 * The creator is not excluded: they get it like anyone else who passes the eligibility check.
 * Never throws: a push problem must not fail the save that triggered it.
 */
export async function announceNewEventIfOpen(eventId: string, before?: EligibilityItem | null): Promise<void> {
  try {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return;
    if (event.walkInsOnly || event.startTime.getTime() <= Date.now()) return;
    if (!isOpenToStudents(event.allowedRoles)) return;

    if (event.newEventPushedAt) {
      if (!before) return;
      const [was, now] = await Promise.all([getNewEventAudienceUserIds(before), getNewEventAudienceUserIds(event)]);
      const already = new Set(was);
      const added = now.filter((id) => !already.has(id));
      await PushService.sendToUserIds(added, newEventPayload({ eventId, title: event.title, startTime: event.startTime }));
      return;
    }

    const claimed = await db
      .update(events)
      .set({ newEventPushedAt: new Date() })
      .where(and(eq(events.id, eventId), isNull(events.newEventPushedAt)))
      .returning({ id: events.id });
    if (claimed.length === 0) return;

    const audience = await getNewEventAudienceUserIds(event);
    await PushService.sendToUserIds(audience, newEventPayload({ eventId, title: event.title, startTime: event.startTime }));
  } catch (err) {
    console.error("New-event push failed:", err);
  }
}

// Audit action prefix for a manual re-send. The last such row per event is the cooldown clock,
// so the cooldown needs no column of its own.
const REPUSH_ACTION = "Re-sent event push";

export type RepushCheck =
  | { ok: true; event: typeof events.$inferSelect; audience: string[] }
  | { ok: false; reason: "not_found" | "hidden" | "started"; }
  | { ok: false; reason: "cooldown"; retryAfterMs: number };

async function lastRepushAt(eventId: string, q: Pick<typeof db, "select"> = db): Promise<Date | null> {
  const [row] = await q
    .select({ at: auditLogs.timestamp })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetId, eventId), like(auditLogs.action, `${REPUSH_ACTION}%`)))
    .orderBy(desc(auditLogs.seq))
    .limit(1);
  return row?.at ?? null;
}

/** Whether an event's push may be re-sent right now, and to whom. */
export async function checkEventRepush(eventId: string, q: Pick<typeof db, "select"> = db): Promise<RepushCheck> {
  const [event] = await q.select().from(events).where(eq(events.id, eventId));
  if (!event) return { ok: false, reason: "not_found" };
  if (event.walkInsOnly || !isOpenToStudents(event.allowedRoles)) return { ok: false, reason: "hidden" };
  if (event.startTime.getTime() <= Date.now()) return { ok: false, reason: "started" };
  const wait = repushWaitMs(await lastRepushAt(eventId, q), new Date());
  if (wait > 0) return { ok: false, reason: "cooldown", retryAfterMs: wait };
  return { ok: true, event, audience: await getNewEventAudienceUserIds(event) };
}

/**
 * Admin "re-send push": re-checks the rules, writes the audit row (which starts the
 * cooldown) and marks the event announced, all in one transaction under a per-event
 * lock so two clicks can't both send. Returns the audience; the caller sends the push.
 */
export async function claimEventRepush(eventId: string, actorId: string, ipAddress: string): Promise<RepushCheck> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`event-repush:${eventId}`}))`);
    const check = await checkEventRepush(eventId, tx);
    if (!check.ok) return check;
    await tx.update(events).set({ newEventPushedAt: new Date() }).where(and(eq(events.id, eventId), isNull(events.newEventPushedAt)));
    await AuditService.logActionInternal(tx, {
      actorId,
      targetId: eventId,
      action: `${REPUSH_ACTION}: "${check.event.title}" to ${check.audience.length} recipient(s)`,
      ipAddress,
    });
    return check;
  });
}

/** Sends the reminder push for a claimed re-send. Never throws. */
export async function sendEventRepush(event: typeof events.$inferSelect, audience: string[]): Promise<void> {
  try {
    await PushService.sendToUserIds(audience, eventReminderPayload({ eventId: event.id, title: event.title, startTime: event.startTime }));
  } catch (err) {
    console.error("Event re-push failed:", err);
  }
}
