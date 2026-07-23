import { auth } from "@/auth";
import { db } from "@/db";
import { events, attendance, eventSessions, eventProposals, users } from "@/db/schema";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { and, eq, inArray, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionInputSchema, sessionsHaveInvalidSpan } from "@/lib/event-schema";
import { syncEventToSongsue } from "@/lib/songsue-sync";

const eventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  registrationOpenTime: z.string().datetime().optional().nullable(),
  registrationCloseTime: z.string().datetime().optional().nullable(),
  quota: z.number().int().min(0).optional().nullable(),
  location: z.string().optional().nullable(),
  pointsAwarded: z.number().int().min(0).max(10000).optional().nullable(),
  individualPointsAwarded: z.number().int().min(0).max(10000).optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  imageUrls: z.array(z.string()).optional().nullable(),
  walkInsEnabled: z.boolean().optional(),
  // Walk-ins-only: no pre-registration is accepted at all (see the register
  // route). Implies walkInsEnabled — enforced below, not just trusted from the client.
  walkInsOnly: z.boolean().optional(),
  quotaWalkIn: z.number().int().min(0).optional().nullable(),
  registrationMode: z.enum(["once", "per_session"]).optional(),
  // Multi-day sessions. Omitted/empty → one default session mirroring the
  // event's own start/end is auto-created so every event has ≥1 session.
  sessions: z.array(sessionInputSchema).optional(),
  targetThai: z.boolean().optional(),
  targetInternational: z.boolean().optional(),
  quotaThai: z.number().int().min(0).optional().nullable(),
  quotaInternational: z.number().int().min(0).optional().nullable(),
  allowedRoles: z.array(z.string()).optional().nullable(),
  allowedMajors: z.array(z.string()).optional().nullable(),
  // Club-based participant eligibility (SEPARATE from ownerClubIds below, which
  // controls who MANAGES the event) — see events.allowedClubs in schema.ts.
  allowedClubs: z.array(z.string().uuid()).optional().nullable(),
  // Restrict the event to the current first-year intake (id-prefix derived).
  firstYearOnly: z.boolean().optional(),
  // Which president role(s) MANAGE this event (club_president / major_president).
  // Separate from allowedRoles (participant visibility) — see GET scoping above.
  managedByRoles: z.array(z.string()).optional().nullable(),
  // WHICH club(s)/major(s) own this event — see EventScopeService. Required for a
  // club_president/major_president in managedByRoles to actually see the event;
  // left empty it stays hidden from every president until staff assigns an owner.
  ownerClubIds: z.array(z.string().uuid()).optional().nullable(),
  ownerMajors: z.array(z.string()).optional().nullable(),
  // Specific user IDs assigned as staff for THIS event (as opposed to the
  // role-based fields above) — exempts their attendance from quota counts and
  // no-show strikes. See events.staffUserIds in schema.ts.
  staffUserIds: z.array(z.string()).optional().nullable(),
  // "Also count for Songsue" — staff-only. See events.songsueLinked in schema.ts.
  songsueLinked: z.boolean().optional(),
  // Present when this event is being created FROM a club_president's proposal
  // (see /api/admin/event-proposals). Purely a linkage marker — staff still
  // fills in every field above explicitly; this just flips the source proposal
  // to 'approved' in the same transaction. See the POST handler below.
  proposalId: z.string().uuid().optional(),
}).refine((d) => new Date(d.endTime) > new Date(d.startTime), {
  message: "endTime must be after startTime",
  path: ["endTime"],
}).refine(
  (d) => !d.sessions || !sessionsHaveInvalidSpan(d.sessions),
  {
    // Only fires with an EXPLICIT per-day schedule (2+ session rows) where one
    // row itself spans multiple days — a single session (incl. the implicit
    // one mirroring startTime/endTime when no sessions are sent) may
    // legitimately span several days, e.g. a multi-day camp with one combined
    // check-in for the whole event. See sessionsHaveInvalidSpan.
    message: "Each day in a per-day schedule must start and end on the same calendar day — add each additional day as its own session instead of stretching one across several dates",
    path: ["endTime"],
  },
);

// Per-event distinct-attendee counts. This GROUP BY over the whole (event-time-
// growing) attendance table is the costly part of this endpoint, which is polled
// every 8–15s by every admin/scanner client — so cache it at the app layer for 15s.
// The counts are global; the per-president scoping is applied in-memory after. Up to
// 15s of count staleness during a live event is an accepted tradeoff.
const getAttendeeCounts = unstable_cache(
  async () =>
    db
      .select({
        eventId: attendance.eventId,
        count: sql<number>`count(distinct ${attendance.studentId})`,
      })
      .from(attendance)
      // Staff rows don't count toward the displayed "X registered" headcount —
      // mirrors the quota exemption in register/route.ts and scanner.service.ts.
      .where(eq(attendance.isStaff, false))
      .groupBy(attendance.eventId),
  ["admin-events-attendee-counts"],
  { revalidate: 15, tags: ["admin-events-attendee-counts"] },
);

// GET /api/admin/events — List all events with registration counts
export async function GET() {
  try {
    const session = await auth();
    // Scanner-only roles (smo, club_president, major_president) are included here
    // (read-only list) because the QR Scanner's event picker fetches this endpoint;
    // write handlers (POST/PUT/DELETE) deliberately exclude them.
    const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
    const smoPosition = session?.user?.smoPosition;
    const anusmoPosition = session?.user?.anusmoPosition;
    const isRoleAdmin = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer", "smo", "club_president", "major_president"].includes(r));
    const isAdminRole = isRoleAdmin || (!!session?.user?.id
      && (await EventScopeService.hasRegistrationScope(session.user.id, myRoles, smoPosition, anusmoPosition)));
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Event scoping for president roles: club_president / major_president see ONLY
    // events they own (ownerClubIds/ownerMajors match their own club membership /
    // major — see EventScopeService), not merely events tagged with the generic
    // managedByRoles president tag. This is independent of allowedRoles (participant
    // visibility). Staff roles, smo, and a global registration position (smo/anusmo
    // + position="registration") are unscoped (see all). A club/major-scoped
    // registration position (case 2/3) is scoped the same way presidents are. This
    // drives both the admin events page AND the scanner's event picker, which
    // share this endpoint.
    const isStaff = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r))
      || isGlobalRegistrationPosition(myRoles, smoPosition, anusmoPosition);
    const presidentTags = myRoles.filter((r) => ["club_president", "major_president"].includes(r));
    const access = await EventScopeService.resolveEventAccess({
      userId: session.user.id!, roles: myRoles, smoPosition, anusmoPosition, isUnscopedStaff: isStaff, hasPresidentTag: presidentTags.length > 0,
    });
    const presidentScope = access.allowed && !access.unscoped ? access.scope : null;

    // Award runs deliberately do NOT live on this polled read path — they run on
    // their own isolated, advisory-locked endpoints (/api/admin/award-check and
    // /api/cron/award-points). Pulling every attendance row in here just to count
    // it is what starved the DB pooler and 504'd the site; this is polled every 8s.

    const list = await db.query.events.findMany({
      orderBy: (events, { desc }) => [desc(events.startTime)],
      with: {
        // Joined so the pending-changes review banner can show who submitted
        // the edit, not just when — see events.pendingDetailsSubmittedBy.
        pendingSubmitter: { columns: { id: true, name: true } },
      },
    });

    // Attendee counts via a single grouped aggregate (DISTINCT students — a multi-day
    // 'once' event has one attended row per day for the same person). Cached for 15s
    // (see getAttendeeCounts) so this whole-table GROUP BY isn't re-run on every poll.
    const counts = await getAttendeeCounts();

    const countByEvent = new Map(counts.map((c) => [c.eventId, Number(c.count)]));

    // Sessions for every event in one query, grouped in memory (O(events) rows).
    // The scanner's day picker and the admin event editor both read these.
    const allSessions = await db.query.eventSessions.findMany({
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });
    const sessionsByEvent = new Map<string, typeof allSessions>();
    for (const s of allSessions) {
      const arr = sessionsByEvent.get(s.eventId) ?? [];
      arr.push(s);
      sessionsByEvent.set(s.eventId, arr);
    }

    const eventsWithCount = list.map((e) => ({
      ...e,
      attendeeCount: countByEvent.get(e.id) ?? 0,
      sessions: sessionsByEvent.get(e.id) ?? [],
    }));

    const scoped = presidentScope
      ? EventScopeService.filterEventsByScope(eventsWithCount, presidentScope)
      : eventsWithCount;

    return NextResponse.json(scoped);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/events — Create event
export async function POST(req: Request) {
  try {
    const session = await auth();
    // effectiveRoles, not the singular session.user.role — otherwise a staffer
    // whose PRIMARY role isn't in this admin set (e.g. a registration officer
    // who is also tagged club_president elsewhere) gets wrongly rejected here,
    // matching how PUT /api/admin/events/[id] already resolves roles.
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    // Creating a brand-new event has no existing ownerClubIds/ownerMajors to scope
    // against, so a club/major-scoped registration position (case 2/3) does NOT
    // get this — only a GLOBAL registration position (smo/anusmo, case 1) does,
    // matching the org-wide-capability split used elsewhere in this rollout.
    const isAdminRole = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const data = eventSchema.parse(body);

    // Normalize posters: drop blanks, dedupe-free order preserved. The cover
    // (imageUrl) always mirrors imageUrls[0] so single-image consumers keep working.
    const posters = (data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : []))
      .filter((u): u is string => typeof u === "string" && u.trim() !== "");
    const cover = posters[0] ?? null;

    // Sessions: use the provided list, or auto-create one default session
    // mirroring the event's own window so every event has ≥1 session.
    const sessionsInput = (data.sessions && data.sessions.length > 0)
      ? data.sessions
      : [{ title: null, startTime: data.startTime, endTime: data.endTime, quotaWalkIn: data.quotaWalkIn ?? null }];

    const ip = getClientIp(req);

    const event = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(events)
        .values({
          title: data.title,
          description: data.description,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
          registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
          quota: data.quota,
          location: data.location,
          pointsAwarded: data.pointsAwarded ?? 0,
          individualPointsAwarded: data.individualPointsAwarded ?? 0,
          imageUrl: cover,
          imageUrls: posters,
          // walkInsOnly implies walkInsEnabled regardless of what the client sent —
          // an event that only accepts walk-ins obviously must accept walk-ins.
          walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
          walkInsOnly: data.walkInsOnly ?? false,
          quotaWalkIn: data.quotaWalkIn,
          registrationMode: data.registrationMode ?? "once",
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          quotaThai: data.quotaThai,
          quotaInternational: data.quotaInternational,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
          firstYearOnly: data.firstYearOnly ?? false,
          managedByRoles: data.managedByRoles && data.managedByRoles.length > 0 ? data.managedByRoles : null,
          ownerClubIds: data.ownerClubIds && data.ownerClubIds.length > 0 ? data.ownerClubIds : null,
          ownerMajors: data.ownerMajors && data.ownerMajors.length > 0 ? data.ownerMajors : null,
          staffUserIds: data.staffUserIds && data.staffUserIds.length > 0 ? data.staffUserIds : null,
          songsueLinked: data.songsueLinked ?? false,
          // Staff is creating (and has therefore already reviewed) every field
          // right now — unlike the DB column default of 'pending', which exists
          // for the president-edit-triggers-re-review case (see PUT
          // /api/admin/events/[id]). Without this, every brand-new event opened
          // in the editor showed a "pending review" banner with nothing to
          // review yet.
          detailsReviewStatus: "approved",
          detailsReviewedBy: session.user!.id!,
          detailsReviewedAt: new Date(),
        })
        .returning();

      await tx.insert(eventSessions).values(
        sessionsInput.map((s, i) => ({
          eventId: created.id,
          title: s.title?.trim() ? s.title.trim() : null,
          startTime: new Date(s.startTime),
          endTime: new Date(s.endTime),
          sortOrder: i,
          quotaWalkIn: s.quotaWalkIn ?? null,
        }))
      );

      // Log the event creation (through the service so the hash chain stays intact)
      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `Created Event: ${created.title} (${sessionsInput.length} session${sessionsInput.length > 1 ? "s" : ""})`,
        ipAddress: ip,
      });

      // Approving a club_president's proposal is a SIDE EFFECT of staff creating
      // the real event from it, not a separate mutation — this rides the
      // already-audited create transaction instead of adding a second
      // privileged write path. The WHERE status='pending' guard means a
      // proposal that was concurrently withdrawn/rejected/already-approved is
      // simply left untouched; event creation still succeeds either way.
      if (data.proposalId) {
        const [linked] = await tx
          .update(eventProposals)
          .set({
            status: "approved",
            reviewedBy: session.user!.id!,
            reviewedAt: new Date(),
            resultingEventId: created.id,
            updatedAt: new Date(),
          })
          .where(and(eq(eventProposals.id, data.proposalId), eq(eventProposals.status, "pending")))
          .returning({ id: eventProposals.id });

        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          action: linked
            ? `Approved event proposal ${data.proposalId} -> created event ${created.id}`
            : `Created event ${created.id} from proposal ${data.proposalId} (proposal was no longer pending; left untouched)`,
          ipAddress: ip,
        });
      }

      return created;
    });

    // Best-effort mirror into Songsue — never blocks this save (see songsue-sync.ts).
    if (event.songsueLinked) {
      const staff = event.staffUserIds && event.staffUserIds.length > 0
        ? await db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.id, event.staffUserIds))
        : [];
      await syncEventToSongsue({
        externalId: event.id,
        title: event.title,
        description: event.description,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        location: event.location,
        pointsAwarded: event.pointsAwarded,
        individualPointsAwarded: event.individualPointsAwarded,
        walkInsEnabled: event.walkInsEnabled,
        quota: event.quota,
        quotaWalkIn: event.quotaWalkIn,
        imageUrl: event.imageUrl,
        imageUrls: event.imageUrls,
        staff,
      });
    }

    return NextResponse.json({ success: true, event: event }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", ") 
      }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
