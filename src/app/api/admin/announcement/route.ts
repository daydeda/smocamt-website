import { auth } from "@/auth";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Only super_admin and admin may view/edit the announcement — registration and
// organizer can enter /admin but are NOT allowed to touch it. We check the full
// roles array (a user can hold several roles), not just the primary role.
function canEditAnnouncement(session: Session | null): boolean {
  if (!session?.user) return false;
  const roles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return roles.some((r) => r === "super_admin" || r === "admin");
}

const announcementSchema = z.object({
  body: z.string().min(1).max(5000),
  enabled: z.boolean(),
});

// GET /api/admin/announcement — current singleton ({ body, enabled }) for the editor.
export async function GET() {
  try {
    const session = await auth();
    if (!canEditAnnouncement(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .select({ body: announcements.body, enabled: announcements.enabled })
      .from(announcements)
      .orderBy(desc(announcements.updatedAt))
      .limit(1);

    return NextResponse.json(row ?? { body: "", enabled: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT /api/admin/announcement — upsert the singleton announcement + audit log.
export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!canEditAnnouncement(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = announcementSchema.parse(await req.json());

    await db.transaction(async (tx) => {
      // Singleton: update the most-recently-updated row, or insert the first one.
      const [existing] = await tx
        .select({ id: announcements.id })
        .from(announcements)
        .orderBy(desc(announcements.updatedAt))
        .limit(1);

      if (existing) {
        await tx
          .update(announcements)
          .set({
            body: data.body,
            enabled: data.enabled,
            updatedBy: session!.user!.id!,
            updatedAt: new Date(),
          })
          .where(eq(announcements.id, existing.id));
      } else {
        await tx.insert(announcements).values({
          body: data.body,
          enabled: data.enabled,
          updatedBy: session!.user!.id!,
        });
      }

      await AuditService.logActionInternal(tx, {
        actorId: session!.user!.id!,
        action: `Updated dashboard announcement (enabled: ${data.enabled})`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
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
