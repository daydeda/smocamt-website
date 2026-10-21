import { auth } from "@/auth";
import { db } from "@/db";
import { calendarEntries } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

// Only the four managing roles may create/edit/delete calendar entries. Scanner
// roles (smo, club_president, major_president) are deliberately excluded — same
// rule as event writes.
const MANAGING_ROLES = ["super_admin", "admin", "registration", "organizer"];

const entrySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  allDay: z.boolean().optional(),
  eventId: z.string().uuid().optional().nullable(),
  allowedRoles: z.array(z.string()).optional().nullable(),
  allowedMajors: z.array(z.string()).optional().nullable(),
  targetThai: z.boolean().optional(),
  targetInternational: z.boolean().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrenceUntil: z.string().datetime().optional().nullable(),
})
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine(
    (d) => {
      if (d.recurrence && d.recurrence !== "none") {
        return !!d.recurrenceUntil && new Date(d.recurrenceUntil) > new Date(d.startTime);
      }
      return true;
    },
    { message: "recurrenceUntil is required and must be after startTime for recurring entries", path: ["recurrenceUntil"] }
  );

// POST /api/admin/calendar — create a calendar entry
export async function POST(req: Request) {
  try {
    const session = await auth();
    const isManaging = MANAGING_ROLES.includes(session?.user?.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isManaging) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = entrySchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const entry = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(calendarEntries)
        .values({
          title: data.title,
          description: data.description ?? null,
          location: data.location ?? null,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          allDay: data.allDay ?? false,
          eventId: data.eventId ?? null,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          recurrence: data.recurrence ?? "none",
          recurrenceUntil: data.recurrenceUntil ? new Date(data.recurrenceUntil) : null,
          createdBy: session.user!.id!,
        })
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `Created Calendar Entry: ${created.title}`,
        ipAddress: ip,
      });

      return created;
    });

    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
