import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { isGlobalRegistrationPosition } from "@/lib/admin-access";
import { redactEmergencyContacts } from "@/lib/emergency-contacts";
import { medicalCategoriesOf } from "@/lib/medical-signal";

// Columns read for a normal/staff roster. Medical free-text + emergency contacts
// are fetched so super_admin/admin (and, per the sanitize step, a club/major
// president viewing their own event) get full detail and registration/organizer
// can have the medical-CATEGORY signal derived below; they are stripped per-role
// in the sanitize step.
const FULL_USER_COLUMNS = {
  id: true,
  name: true,
  nickname: true,
  studentId: true,
  major: true,
  phone: true,
  role: true,
  roles: true,
  chronicDiseases: true,
  medicalHistory: true,
  drugAllergies: true,
  foodAllergies: true,
  dietaryRestrictions: true,
  faintingHistory: true,
  emergencyMedication: true,
  emergencyContacts: true,
  noShowCount: true,
} as const;

// Thin-roster role (smo) only ever receives identity + check-in (see sanitize
// step), so don't even fetch phone, emergency contacts, or medical detail. A
// strict subset of FULL_USER_COLUMNS. noShowCount is the exception — it's a
// strike tally, not PDPA-sensitive, so every role that reaches this roster
// gets it (powers the no-show filter).
const THIN_USER_COLUMNS = {
  id: true,
  name: true,
  nickname: true,
  studentId: true,
  major: true,
  role: true,
  roles: true,
  noShowCount: true,
} as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
    const smoPosition = session?.user?.smoPosition;
    const anusmoPosition = session?.user?.anusmoPosition;
    // A global registration position (smo/anusmo + position="registration") gets
    // the full staff-tier breadth org-wide — fold it into isStaffRole.
    const globalReg = isGlobalRegistrationPosition(myRoles, smoPosition, anusmoPosition);
    // Staff roles get the full/standard roster. Scanner-only student-leader roles
    // (smo, club_president, major_president) may also view attendance; smo gets a
    // THIN roster only (see isThinRoster below), while club_president/
    // major_president get the FULL roster (incl. medical detail, see
    // isPresidentRole below) for events they own, scoped server-side further down.
    const isStaffRole = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r)) || globalReg;
    const isThinRosterRole = myRoles.some((r) => ["smo", "club_president", "major_president"].includes(r));
    // A club/major-scoped registration position (case 2/3: not staff, not global)
    // is a distinct entry path — full (non-thin) roster, but scoped to only the
    // events their club/major owns, same as club_president/major_president below.
    const isPositionScopedRegistration = !isStaffRole && !!session?.user?.id
      && (await EventScopeService.hasRegistrationScope(session.user.id, myRoles, smoPosition, anusmoPosition));
    if (!session?.user || (!isStaffRole && !isThinRosterRole && !isPositionScopedRegistration)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // PDPA-sensitive medical & emergency-contact data is restricted to
    // super_admin/admin (mirrors canExportAttendance on the admin events page).
    // registration/organizer get the roster without health info.
    const canViewMedical = myRoles.includes("super_admin") || myRoles.includes("admin");
    // A club/major president viewing an event THEY MANAGE (scoping enforced
    // below) gets the same medical-detail breadth as canViewMedical — by
    // deliberate product decision (2026-07-18) mirroring the club/major
    // member-roster grant (see ClubsService.getClubMembers) — EXCEPT emergency
    // contacts are redacted to relationship + phone only (no contact name),
    // same as that roster. The audit log below is the accountability mechanism
    // standing in for the narrower field set canViewMedical would otherwise get.
    const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));
    // Thin roster: smo sees basic identity + check-in only — NO phone,
    // emergency contacts, or medical signal. Any staff role, a (possibly
    // scoped) registration-position holder, or a president viewing their own
    // event overrides this.
    const isThinRoster = !isStaffRole && !isPositionScopedRegistration && !isPresidentRole;

    const { id: eventId } = await params;

    // Event scoping for president roles (mirrors the /api/admin/events list filter)
    // AND for a club/major-scoped registration position: they may only read
    // attendance for events their club/major OWNS (ownerClubIds/ownerMajors — see
    // EventScopeService), independent of allowedRoles. Staff and a global
    // registration position are unscoped. This is what makes the medical-detail
    // grant above safe: a president only ever reaches this branch for an event
    // their own club/major owns, never someone else's.
    if (!isStaffRole && (isPresidentRole || isPositionScopedRegistration)) {
      const ev = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { ownerClubIds: true, ownerMajors: true },
      });
      const access = await EventScopeService.resolveEventAccess({
        userId: session.user.id!, roles: myRoles, smoPosition, anusmoPosition, isUnscopedStaff: false, hasPresidentTag: isPresidentRole,
      });
      const managed = access.allowed && (access.unscoped || (ev ? EventScopeService.isEventManagedByScope(ev, access.scope) : false));
      if (!managed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    // Optional ?sessionId= filter narrows the roster to one day of a multi-day event.
    const sessionIdFilter = new URL(req.url).searchParams.get("sessionId");

    const list = await db.query.attendance.findMany({
      where: sessionIdFilter
        ? and(eq(attendance.eventId, eventId), eq(attendance.sessionId, sessionIdFilter))
        : eq(attendance.eventId, eventId),
      with: {
        // Which session (day) this check-in belongs to, for per-day reporting.
        session: {
          columns: { id: true, title: true, sortOrder: true, startTime: true, endTime: true },
        },
        user: {
          // Staff get the full SELECT (medical detail is read here so the
          // "has a condition" signal can be derived, then forwarded only to
          // super_admin/admin). Thin-roster roles get a reduced SELECT — phone /
          // emergency contacts / medical are stripped from their response anyway,
          // so they aren't fetched. The cast keeps the inferred row type stable;
          // the omitted columns are simply absent at runtime and never read on the
          // thin-roster path.
          columns: (isThinRoster
            ? THIN_USER_COLUMNS
            : FULL_USER_COLUMNS) as typeof FULL_USER_COLUMNS,
          with: {
            house: {
              columns: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
    });

    // Which medical CATEGORIES a user filled in (mirrors hasActualMedicalInfo
    // on the client). The identifiers match i18n keys so the client can
    // translate them directly — values are never included, so non-admins
    // learn the category but not the detail. Shared with the scanner and the
    // XLSX export so all three agree on what counts as "flagged".
    const categoriesOf = (u: (typeof list)[number]["user"]) => (u ? medicalCategoriesOf(u) : []);

    // super_admin/admin receive the full record (plus the hasMedicalInfo flag).
    // A president viewing their own event gets the same full detail, minus the
    // emergency contact's name (see isPresidentRole comment above).
    // registration/organizer get only the list of categories present — never the
    // detail the student filled in — and no meds-check status (which would
    // itself reveal a condition).
    const sanitized = list.map((row) => {
      const u = row.user;
      const medicalCategories = categoriesOf(u);
      const hasMedicalInfo = medicalCategories.length > 0;
      if (canViewMedical) {
        return { ...row, user: u ? { ...u, hasMedicalInfo } : u };
      }
      if (isPresidentRole) {
        const presidentUser = u && {
          ...u,
          hasMedicalInfo,
          emergencyContacts: redactEmergencyContacts(u.emergencyContacts),
        };
        return { ...row, user: presidentUser };
      }
      // Scanner-only student-leader roles: identity + check-in only. Strip phone,
      // emergency contacts, and the medical signal (no hasMedicalInfo/categories).
      if (isThinRoster) {
        const thinUser = u && {
          id: u.id,
          name: u.name,
          nickname: u.nickname,
          studentId: u.studentId,
          major: u.major,
          role: u.role,
          roles: u.roles,
          house: u.house,
          noShowCount: u.noShowCount,
        };
        return { ...row, medsCheckOption: null, user: thinUser };
      }
      const safeUser = u && {
        id: u.id,
        name: u.name,
        nickname: u.nickname,
        studentId: u.studentId,
        major: u.major,
        phone: u.phone,
        role: u.role,
        roles: u.roles,
        emergencyContacts: u.emergencyContacts,
        house: u.house,
        hasMedicalInfo,
        medicalCategories,
        noShowCount: u.noShowCount,
      };
      return { ...row, medsCheckOption: null, user: safeUser };
    });

    // FE-12 / PDPA: log every access that returns sensitive data. Admins receive
    // full medical detail; registration/organizer receive emergency contacts + the
    // medical-category signal — BOTH are auditable PDPA reads, so log them too. This
    // used to fire ONLY for canViewMedical, leaving registration/organizer reads of
    // emergency-contact PII untracked. Thin-roster scanner roles get no sensitive
    // data (identity + check-in only), so they are not logged.
    if (canViewMedical || isPresidentRole || !isThinRoster) {
      const ev = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { title: true },
      });
      const eventLabel = ev ? `"${ev.title}" (${eventId})` : eventId;

      if (canViewMedical) {
        await AuditService.logAction({
          actorId: session.user.id!,
          action: `Viewed Attendance List for Event ${eventLabel} (included health detail + emergency contacts)`,
          ipAddress: getClientIp(req),
        });
      } else if (isPresidentRole) {
        await AuditService.logAction({
          actorId: session.user.id!,
          action: `Viewed Attendance List for Event ${eventLabel} (included health detail + emergency contacts (relationship/phone only, president tier))`,
          ipAddress: getClientIp(req),
        });
      } else {
        await AuditService.logAction({
          actorId: session.user.id!,
          action: `Viewed Attendance List for Event ${eventLabel} (emergency contacts + medical-category signal)`,
          ipAddress: getClientIp(req),
        });
      }
    }

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("Failed to fetch attendance:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Removes a single student's registration/check-in rows for this event (all
// sessions of a multi-day event, since a wrongly-registered student shouldn't
// remain on any day). Deliberately admin/registration only — NOT organizer and
// NOT presidents: a president removing a peer's registration is a real bias/
// conflict-of-interest risk (the "wrong club" justification is easy to fake),
// and the audit log only catches that after the fact. allowedClubs (see
// event-access.ts) now prevents wrong-club registration proactively, which was
// the original motivating case for president self-service removal.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
    const isStaffRole = myRoles.some((r) => ["super_admin", "admin", "registration"].includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isStaffRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const studentId = new URL(req.url).searchParams.get("studentId");
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const ev = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true },
    });
    if (!ev) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const removedRows = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(attendance)
        .where(and(eq(attendance.eventId, eventId), eq(attendance.studentId, studentId)))
        .returning({ id: attendance.id });
      if (deleted.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: session.user.id!,
          targetId: studentId,
          action: `Removed registration for student ${studentId} from event "${ev.title}" (${eventId}) — ${deleted.length} row(s)`,
          ipAddress: getClientIp(req),
        });
      }
      return deleted;
    });

    if (removedRows.length === 0) {
      return NextResponse.json({ error: "Student is not registered for this event" }, { status: 404 });
    }

    return NextResponse.json({ removed: removedRows.length });
  } catch (error) {
    console.error("Failed to remove registrant:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
