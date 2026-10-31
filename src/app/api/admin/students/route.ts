import { auth } from "@/auth";
import { UsersService } from "@/modules/users/users.service";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

// Fail fast instead of hanging to the 300s platform default if the DB pooler stalls.
export const maxDuration = 20;

export async function GET() {
  try {
    const session = await auth();
    const myRoles = session?.user
      ? effectiveRoles(session.user.role, session.user.roles)
      : [];
    // Mirror canEditRestrictedFields on the admin events page (the only current
    // caller of this bulk directory): a global registration position
    // (smo holding smoPosition === "registration") can
    // also open the Event Staff picker there. A 401 here silently falls back to
    // an empty list, which makes an unregistered staff assignee render as
    // "Unknown / No ID" (the picker has no directory entry to resolve the id against).
    const globalReg = session?.user
      ? isGlobalRegistrationPosition(myRoles, session.user.smoPosition, session.user.anusmoPosition)
      : false;
    if (
      !session?.user ||
      !(myRoles.some((r) => ["super_admin", "admin"].includes(r)) || globalReg)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Contact info (email/phone/contactChannels) is only ever included for
    // super_admin — everyone else on this bulk directory endpoint gets the
    // PDPA-minimal columns, same as before.
    const isSuperAdmin = myRoles.includes("super_admin");

    const allStudents = await UsersService.listStudentDirectory(isSuperAdmin);

    return NextResponse.json(allStudents);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
