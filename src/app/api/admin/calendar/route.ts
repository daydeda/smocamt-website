import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { CalendarService } from "@/modules/calendar/calendar.service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

// Only admin/super_admin and a global registration position (smo/anusmo) may
// create/edit/delete calendar entries. Scanner roles (plain smo, club_president,
// major_president) are deliberately excluded — same rule as event writes.
const MANAGING_ROLES = ["super_admin", "admin"];

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

    const entry = await CalendarService.createEntry(data, session.user!.id!, ip);

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
