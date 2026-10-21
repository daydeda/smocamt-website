import { auth } from "@/auth";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { VIEW_APPEALS_ROLES } from "@/lib/points/strikes";
import { AppealsService } from "@/modules/appeals/appeals.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/appeals — list no-show appeals for staff review, most recent
// first. Gated by VIEW_APPEALS_ROLES (src/lib/strikes.ts): super_admin/admin/
// registration/smo see every appeal; club_president/major_president are scoped
// to appeals whose event they own (EventScopeService, mirroring
// api/admin/events' list scoping) — an appeal with no linked event, or one
// linked to an event they don't own, is hidden from them. Whether a viewer may
// also resolve (approve/reject) an appeal is enforced separately and more
// narrowly by PATCH /api/admin/appeals/[id] (RESOLVE_APPEALS_ROLES excludes
// smo). Each appeal is tied to one specific
// event (US-STRI-15c: per-event appeals, not a blanket account appeal) via the
// direct eventId relation — no more best-effort matching against a user's
// recent no-show attendance rows.
export async function GET(req: Request) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    // Additively admits a registration position (global via smo/anusmo, OR
    // club/major-scoped — mirrors PATCH /api/admin/appeals/[id]'s entry gate,
    // not just the global case) — the scoping below then narrows a scoped
    // holder down to their own club/major's appeals.
    const isRoleAdmin = myRoles.some((r) => (VIEW_APPEALS_ROLES as readonly string[]).includes(r));
    const canView = isRoleAdmin || (!!session?.user?.id
      && (await EventScopeService.hasRegistrationScope(session.user.id, myRoles, session.user.smoPosition, session.user.anusmoPosition)));
    if (!session?.user || !canView) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const appeals = await AppealsService.listForReview(status);

    const isUnscoped = myRoles.some((r) => ["super_admin", "admin", "registration", "smo"].includes(r))
      || isGlobalRegistrationPosition(myRoles, session.user.smoPosition, session.user.anusmoPosition);
    const presidentTags = myRoles.filter((r) => ["club_president", "major_president"].includes(r));
    const access = await EventScopeService.resolveEventAccess({
      userId: session.user!.id!, roles: myRoles, smoPosition: session.user.smoPosition, anusmoPosition: session.user.anusmoPosition, isUnscopedStaff: isUnscoped, hasPresidentTag: presidentTags.length > 0,
    });
    const scoped = access.allowed
      ? (access.unscoped ? appeals : appeals.filter((a) => a.event && EventScopeService.isEventManagedByScope(a.event, access.scope)))
      : [];

    // ownerClubIds/ownerMajors were only fetched for the scoping check above —
    // strip them before returning so the response shape matches what
    // AppealsClient expects.
    const response = scoped.map((a) => ({
      ...a,
      event: a.event ? { id: a.event.id, title: a.event.title, endTime: a.event.endTime } : null,
    }));

    return NextResponse.json({ appeals: response });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
