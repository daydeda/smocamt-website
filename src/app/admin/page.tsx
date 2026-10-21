import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { adminLandingHrefForRoles, effectiveRoles } from "@/lib/access/admin-access";

// Canonical admin entry. The "Admin Panel" links all point here so the landing
// page is decided server-side from the authoritative session roles — not from a
// possibly-stale client session. Scanner-only roles land on the scanner; everyone
// else on the dashboard. Gate on the whole role SET so a president whose primary
// role isn't an entry role still lands correctly. (The layout above already
// redirects unauthenticated/disallowed users.)
export default async function AdminIndex() {
  const session = await auth();
  redirect(adminLandingHrefForRoles(
    effectiveRoles(session?.user?.role, session?.user?.roles),
    session?.user?.hasStaffPosition,
    session?.user?.smoPosition,
    session?.user?.anusmoPosition,
  ));
}
