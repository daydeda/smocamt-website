import { auth } from "@/auth";
import { db } from "@/db";
import { calendarEntries } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

const MANAGING_ROLES = ["super_admin", "admin", "registration", "organizer"];

const entryUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  eventId: z.string().uuid().optional().nullable(),
  allowedRoles: z.array(z.string()).optional().nullable(),
  allowedMajors: z.array(z.string()).optional().nullable(),
  targetThai: z.boolean().optional(),
  targetInternational: z.boolean().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrenceUntil: z.string().datetime().optional().nullable(),
})
  .refine(
    (d) => {
      if (!d.startTime || !d.endTime) return true;
      return new Date(d.endTime) > new Date(d.startTime);
    },
    { message: "endTime must be after startTime", path: ["endTime"] },
  )
  .refine(
    (d) => {
      if (d.recurrence && d.recurrence !== "none") {
        if (!d.recurrenceUntil) return false;
        const ref = d.startTime ? new Date(d.startTime) : new Date(0);
        return new Date(d.recurrenceUntil) > ref;
      }
      return true;
    },
    { message: "recurrenceUntil is required and must be after startTime for recurring entries", path: ["recurrenceUntil"] },
  );

// PUT /api/admin/calendar/[id] — update a calendar entry
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const isManaging = MANAGING_ROLES.includes(session?.user?.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isManaging) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = entryUpdateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    let updated: typeof calendarEntries.$inferSelect;
    try {
      updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(calendarEntries)
          .set({
            ...(data.title && { title: data.title }),
            ...(data.description !== undefined && { description: data.description }),
            ...(data.location !== undefined && { location: data.location }),
            ...(data.startTime && { startTime: new Date(data.startTime) }),
            ...(data.endTime && { endTime: new Date(data.endTime) }),
            ...(data.allDay !== undefined && { allDay: data.allDay }),
            ...(data.eventId !== undefined && { eventId: data.eventId }),
            ...(data.allowedRoles !== undefined && {
              allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
            }),
            ...(data.allowedMajors !== undefined && {
              allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
            }),
            ...(data.targetThai !== undefined && { targetThai: data.targetThai }),
            ...(data.targetInternational !== undefined && { targetInternational: data.targetInternational }),
            ...(data.recurrence !== undefined && { recurrence: data.recurrence }),
            ...(data.recurrenceUntil !== undefined && {
              recurrenceUntil: data.recurrenceUntil ? new Date(data.recurrenceUntil) : null,
            }),
            updatedAt: new Date(),
          })
          .where(eq(calendarEntries.id, id))
          .returning();

        if (!row) throw new Error("ENTRY_NOT_FOUND");

        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          action: `Updated Calendar Entry: ${row.title}`,
          ipAddress: ip,
        });

        return row;
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ENTRY_NOT_FOUND") {
        return NextResponse.json({ error: "Calendar entry not found" }, { status: 404 });
      }
      throw e;
    }

    return NextResponse.json({ success: true, entry: updated });
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

// DELETE /api/admin/calendar/[id] — delete a calendar entry
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const isManaging = MANAGING_ROLES.includes(session?.user?.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isManaging) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ip = getClientIp(req);

    try {
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(calendarEntries)
          .where(eq(calendarEntries.id, id))
          .returning({ id: calendarEntries.id, title: calendarEntries.title });

        if (!deleted) throw new Error("ENTRY_NOT_FOUND");

        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          action: `Deleted Calendar Entry: ${deleted.title}`,
          ipAddress: ip,
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ENTRY_NOT_FOUND") {
        return NextResponse.json({ error: "Calendar entry not found" }, { status: 404 });
      }
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
