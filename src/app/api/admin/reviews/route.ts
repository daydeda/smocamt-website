import { auth } from "@/auth";
import { db } from "@/db";
import { forms, events } from "@/db/schema";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/events/event-proposals";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/reviews — staff-only aggregate of everything a
// club_president/major_president has submitted that's awaiting staff review:
// pending Feedback Forms (forms.reviewStatus, see form-access.ts) and pending
// event detail edits (events.detailsReviewStatus, see PUT /api/admin/events/[id]).
// Before this endpoint, staff had no single place to discover either — they had
// to open each event individually and notice a banner. Reuses
// REVIEW_PROPOSAL_ROLES (the same staff set that reviews event proposals) since
// this is the same "can staff-manage events" role set, not a new gate.
export async function GET() {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    const isStaff = myRoles.some((r) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isStaff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pendingForms = await db.query.forms.findMany({
      where: eq(forms.reviewStatus, "pending"),
      orderBy: (f, { desc }) => [desc(f.updatedAt)],
      with: {
        event: { columns: { id: true, title: true } },
      },
    });

    const pendingEventsRaw = await db.query.events.findMany({
      // Requires an actual pendingDetailsChanges diff, not just the status flag —
      // a stale/defaulted 'pending' status with no diff (e.g. a pre-existing event
      // backfilled by the details_review_status column's DEFAULT 'pending', see
      // drizzle/0030_backfill_details_review_status.sql) has nothing to review.
      where: and(eq(events.detailsReviewStatus, "pending"), isNotNull(events.pendingDetailsChanges)),
      columns: {
        id: true,
        title: true,
        startTime: true,
        ownerClubIds: true,
        ownerMajors: true,
        updatedAt: true,
      },
    });
    // Only genuinely president-owned events — a plain staff-created event
    // defaults to 'pending' too (see events.detailsReviewStatus in schema.ts)
    // but was never edited by a president and has nothing here to review.
    const pendingEvents = pendingEventsRaw.filter(
      (e) => (e.ownerClubIds && e.ownerClubIds.length > 0) || (e.ownerMajors && e.ownerMajors.length > 0)
    );

    return NextResponse.json({
      forms: pendingForms.map((f) => ({
        id: f.id,
        eventId: f.eventId,
        eventTitle: f.event?.title ?? null,
        title: f.title,
        formType: f.formType,
        updatedAt: f.updatedAt,
      })),
      events: pendingEvents.map((e) => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        ownerClubIds: e.ownerClubIds,
        ownerMajors: e.ownerMajors,
        updatedAt: e.updatedAt,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
