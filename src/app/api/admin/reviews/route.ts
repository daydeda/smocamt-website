import { auth } from "@/auth";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/events/event-proposals";
import { EventsService } from "@/modules/events/events.service";
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

    const { pendingForms, pendingEvents } = await EventsService.listPendingReviewItems();

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
