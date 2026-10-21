import { auth } from "@/auth";
import { db } from "@/db";
import { houses, users } from "@/db/schema";
import { houseIdFromParam } from "@/lib/points/houses";
import { COLORS, colorGroupOfHouseId } from "@/lib/profile/faculties";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ houseId: string }> }
) {
  try {
    // The URL carries a colour slug ("mom"); resolve it to a colour group ("red").
    // Houses are now per-faculty, but a colour is "one house" here — the roster spans
    // every faculty's house of that colour.
    const colorGroup = colorGroupOfHouseId(houseIdFromParam((await params).houseId));
    if (!colorGroup) {
      return NextResponse.json({ error: "House not found" }, { status: 404 });
    }

    // PDPA: a house roster exposes real student names — authenticated users only.
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Members are visible only to students of that same colour house. Read the
    // viewer's CURRENT house from the DB rather than the session token — houses are
    // assigned at first check-in now, so a freshly-assigned student's token can be
    // stale. The URL is guessable, so this guard is what enforces "own house only".
    const viewer = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { houseId: true },
    });
    const isAdmin = ["super_admin", "admin", "registration", "organizer"].includes(session.user.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    if (!isAdmin && colorGroupOfHouseId(viewer?.houseId) !== colorGroup) {
      return NextResponse.json(
        { error: "Forbidden: you can only view your own house" },
        { status: 403 }
      );
    }

    // All faculty houses that make up this colour, then their combined roster.
    const colorHouses = await db.query.houses.findMany({
      where: eq(houses.colorGroup, colorGroup),
      columns: { id: true, points: true },
    });
    const houseIds = colorHouses.map((h) => h.id);
    if (houseIds.length === 0) {
      return NextResponse.json({ error: "House not found" }, { status: 404 });
    }

    const meta = COLORS.find((c) => c.id === colorGroup)!;
    const house = {
      id: colorGroup,
      name: meta.name,
      color: meta.color,
      points: colorHouses.reduce((sum, h) => sum + h.points, 0),
    };

    const members = await db.query.users.findMany({
      where: and(inArray(users.houseId, houseIds), eq(users.profileCompleted, true)),
      columns: {
        id: true,
        name: true,
        nickname: true,
        points: true,
        // Faculty lets the client group/badge the combined roster.
        faculty: true,
      },
      // Deterministic tie-break: equal points sort by id so rows don't shuffle
      // between refreshes (matches the leaderboard ordering).
      orderBy: (users, { desc, asc }) => [desc(users.points), asc(users.id)],
    });

    return NextResponse.json(
      { house, members },
      {
        headers: {
          // Private: contains student PII and is auth-gated, so the shared CDN must
          // not store it. Per-browser caching only (mirrors /api/houses/individual).
          "Cache-Control": "private, max-age=30",
        },
      }
    );
  } catch (error) {
    console.error("Failed to fetch house members:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
