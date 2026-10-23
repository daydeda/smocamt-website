import { db } from "@/db";
import { events } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { isOpenToStudents, newEventPayload } from "@/lib/push/reminders";
import { PushService } from "./push.service";
import { getNewEventAudienceUserIds } from "./push-audience";

/**
 * Sends the "new event" push once, the first time an event is open to students.
 * Called after an event is created or edited. An event hidden from students (for
 * example SMO-only) stays unannounced until it is opened; the claim on
 * events.new_event_pushed_at makes that happen exactly once, even across racing edits.
 * The creator is not excluded: they get it like anyone else who passes the eligibility check.
 * Never throws: a push problem must not fail the save that triggered it.
 */
export async function announceNewEventIfOpen(eventId: string): Promise<void> {
  try {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event || event.newEventPushedAt) return;
    if (event.walkInsOnly || event.startTime.getTime() <= Date.now()) return;
    if (!isOpenToStudents(event.allowedRoles)) return;

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
