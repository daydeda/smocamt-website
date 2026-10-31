import { auth } from "@/auth";
import { checkAndAwardPastEventPoints } from "@/lib/points/award-points";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

export const dynamic = "force-dynamic";
// Hard ceiling on this function. Even in the worst case it dies at 15s instead of
// hanging to the 300s platform limit, so a stuck award run can never tie up a
// function slot. The award logic itself also has DB-level lock/statement timeouts.
export const maxDuration = 15;

/**
 * Dedicated, isolated endpoint for the event-winner bonus check. The admin
 * dashboard pings this fire-and-forget on its poll interval, so the bonus is
 * awarded within seconds of an event ending WITHOUT the award work living in the
 * dashboard's read path (where it previously starved the DB pooler and 504'd the
 * whole site). checkAndAwardPastEventPoints is a cheap indexed no-op unless an
 * event actually ended, is advisory-locked across instances, and never throws.
 */
export async function GET() {
  const session = await auth();
  const isAdminRole = ["super_admin", "admin"].includes(
    session?.user?.role || ""
  ) || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
  if (!session?.user || !isAdminRole) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await checkAndAwardPastEventPoints();
  return NextResponse.json({ ok: true });
}
