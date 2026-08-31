import { auth } from "@/auth";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { resolveShopAccess } from "@/lib/shop-scope";
import { FACULTIES } from "@/lib/faculties";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALL_MAJORS = FACULTIES.flatMap((f) => f.majors);

// GET /api/admin/shop/context — who is the current shop-admin caller: are they
// scoped (club_president/major_president) or a full admin, and which club(s)/
// major(s) may they assign as a product owner. Lets AdminShopClient hide the
// Settings tab + the review controls for a scoped president without loading the
// full product list first.
export async function GET() {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeClubs = await db
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .where(eq(clubs.isArchived, false))
      .orderBy(asc(clubs.name));

    const ownerOptions = access.unscoped
      ? { clubs: activeClubs, majors: ALL_MAJORS }
      : {
          clubs: activeClubs.filter((c) => access.scope.clubIds.includes(c.id)),
          majors: ALL_MAJORS.filter((m) => access.scope.majors.includes(m)),
        };

    return NextResponse.json({ scoped: !access.unscoped, ownerOptions });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
