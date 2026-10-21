import { auth } from "@/auth";
import { db } from "@/db";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

export async function GET() {
  try {
    const session = await auth();
    const isAdminRole = ["super_admin", "admin", "registration", "organizer"].includes(session?.user?.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Returns the 4 CAMT colour houses for point adjustments. Ordered for a stable UI.
    const list = await db.query.houses.findMany({
      columns: {
        id: true,
        name: true,
        color: true,
        points: true,
        faculty: true,
        colorGroup: true,
      },
      orderBy: (houses, { asc }) => [asc(houses.faculty), asc(houses.colorGroup)],
    });

    return NextResponse.json(list);
  } catch (error) {
    console.error("Failed to fetch houses:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
