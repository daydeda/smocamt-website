import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, events, noShowAppeals, users } from "@/db/schema";
import { getAppealAudienceUserIds } from "@/modules/notifications/push-audience";
import { PushService } from "@/modules/notifications/push.service";
import { and, desc, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

const appealSchema = z.object({
  eventId: z.string().uuid(),
  message: z.string().trim().min(10).max(1000),
});

// GET /api/appeals — the current student's no-show events, each paired with its
// own appeal (if any) so the dashboard can offer "Appeal" per event, show
// "pending review" for one already under review, and let an event whose appeal
// was rejected be re-appealed — without touching the OTHER no-show events on
// the account (US-STRI-15c: appeals are per-event, not a blanket account reset).
// An event stops appearing here once its appeal is approved: approval flips
// that event's attendance row(s) to 'excused' (see admin/appeals/[id]/route.ts),
// so it naturally drops out of the 'no_show' query below.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const noShowRows = await db.query.attendance.findMany({
      where: and(eq(attendance.studentId, session.user.id), eq(attendance.status, "no_show")),
      columns: { id: true },
      with: { event: { columns: { id: true, title: true, endTime: true } } },
    });

    const eventById = new Map<string, { id: string; title: string; endTime: Date }>();
    for (const row of noShowRows) {
      if (row.event) eventById.set(row.event.id, row.event);
    }

    const appeals = eventById.size
      ? await db.query.noShowAppeals.findMany({
          where: and(eq(noShowAppeals.userId, session.user.id)),
          orderBy: [desc(noShowAppeals.createdAt)],
          columns: {
            id: true,
            eventId: true,
            status: true,
            message: true,
            reviewNote: true,
            createdAt: true,
            reviewedAt: true,
          },
        })
      : [];
    // Most recent appeal per event (a rejected appeal can be re-submitted, so
    // there may be several for the same event over time).
    const latestAppealByEvent = new Map<string, (typeof appeals)[number]>();
    for (const a of appeals) {
      if (a.eventId && !latestAppealByEvent.has(a.eventId)) latestAppealByEvent.set(a.eventId, a);
    }

    const noShowEvents = [...eventById.values()]
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())
      .map((e) => ({ ...e, appeal: latestAppealByEvent.get(e.id) ?? null }));

    return NextResponse.json({ noShowEvents });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/appeals — a student appeals ONE specific no-show event (US-STRI-15c).
// Allowed from the first strike, not just once fully blocked at the threshold.
// Only one pending appeal at a time per (student, event) — the DB's partial
// unique index (no_show_appeals_one_pending_per_user_event) is the real guard
// against a race; the pre-check here just gives a friendlier error. A student
// with several strikes may have several DIFFERENT events pending at once.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = appealSchema.parse(await req.json());

    const [student, noShowRow] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, session.user.id),
        columns: { noShowCount: true },
      }),
      db.query.attendance.findFirst({
        where: and(
          eq(attendance.studentId, session.user.id),
          eq(attendance.eventId, data.eventId),
          eq(attendance.status, "no_show"),
        ),
        columns: { id: true },
      }),
    ]);
    if (!student || student.noShowCount <= 0 || !noShowRow) {
      return NextResponse.json(
        { error: "You don't have a no-show strike for this event to appeal." },
        { status: 400 }
      );
    }

    const existingPending = await db.query.noShowAppeals.findFirst({
      where: and(
        eq(noShowAppeals.userId, session.user.id),
        eq(noShowAppeals.eventId, data.eventId),
        eq(noShowAppeals.status, "pending"),
      ),
      columns: { id: true },
    });
    if (existingPending) {
      return NextResponse.json(
        { error: "You already have an appeal pending review for this event." },
        { status: 409 }
      );
    }

    const [appeal] = await db
      .insert(noShowAppeals)
      .values({
        userId: session.user.id,
        eventId: data.eventId,
        message: data.message,
        noShowCountAtAppeal: student.noShowCount,
      })
      .returning({ id: noShowAppeals.id, status: noShowAppeals.status, createdAt: noShowAppeals.createdAt });

    after(async () => {
      const event = await db.query.events.findFirst({
        where: eq(events.id, data.eventId),
        columns: { title: true, ownerClubIds: true, ownerMajors: true },
      });
      const audience = await getAppealAudienceUserIds(event ?? null);
      await PushService.sendToUserIds(audience, {
        title: "New no-show appeal",
        body: event ? `An appeal was submitted for "${event.title}".` : "A new no-show appeal was submitted.",
        url: "/admin/appeals",
        tag: `appeal:${appeal.id}`,
      });
    });

    return NextResponse.json({ appeal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }
    // The partial unique index catches a rare race the pre-check above misses.
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "You already have an appeal pending review for this event." },
        { status: 409 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
