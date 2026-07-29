import { auth } from "@/auth";
import { db } from "@/db";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";

// Fail fast instead of hanging to the 300s platform default if the DB pooler stalls.
export const maxDuration = 20;

export async function GET() {
  try {
    const session = await auth();
    const myRoles = session?.user
      ? effectiveRoles(session.user.role, session.user.roles)
      : [];
    // Mirror canEditRestrictedFields on the admin events page (the only current
    // caller of this bulk directory): organizer and a global registration
    // position (smo/anusmo holding smoPosition/anusmoPosition === "registration")
    // can also open the Event Staff picker there, but were previously 401'd here
    // — their request silently fell back to an empty list, which is what made
    // an unregistered staff assignee render as "Unknown / No ID" (the picker had
    // no directory entry to resolve the id against).
    const globalReg = session?.user
      ? isGlobalRegistrationPosition(myRoles, session.user.smoPosition, session.user.anusmoPosition)
      : false;
    if (
      !session?.user ||
      !(myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r)) || globalReg)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Contact info (email/phone/contactChannels) is only ever included for
    // super_admin — everyone else on this bulk directory endpoint gets the
    // PDPA-minimal columns, same as before.
    const isSuperAdmin = myRoles.includes("super_admin");

    // Only fetch non-sensitive data for the general directory
    const allStudents = await db.query.users.findMany({
      columns: {
        id: true,
        studentId: true,
        name: true,
        prefix: true,
        nickname: true,
        major: true,
        smoPosition: true,
        anusmoPosition: true,
        houseId: true,
        profileCompleted: true,
        role: true,
        roles: true,
        noShowCount: true,
        registrationBlocked: true,
        ...(isSuperAdmin ? { email: true, phone: true, contactChannels: true } : {}),
      },
      with: { house: true },
    });

    return NextResponse.json(allStudents);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
