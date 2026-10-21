import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { adminLandingHrefForRoles, effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { VIEW_APPEALS_ROLES } from "@/lib/points/strikes";
import { AppealsClient } from "./AppealsClient";

export const dynamic = "force-dynamic";

// The /admin layout already gates entry to super_admin/admin/registration/organizer
// (plus the scanner-only roles, via SCANNER_ONLY_PAGES). This page is further
// restricted to VIEW_APPEALS_ROLES (src/lib/strikes.ts) — reused here (not
// re-hardcoded) so the redirect can't drift from the GET/PATCH
// /api/admin/appeals API's actual gate. Whether a viewer can also resolve
// (approve/reject) appeals is a separate, narrower check (RESOLVE_APPEALS_ROLES)
// enforced by the PATCH route and reflected client-side in AppealsClient.
export default async function AdminAppealsPage() {
  const session = await auth();
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const smoPosition = session?.user?.smoPosition;
  const anusmoPosition = session?.user?.anusmoPosition;
  // Additively admits a registration position (global via smo/anusmo, or
  // club/major-scoped) — matches GET /api/admin/appeals's own gate.
  const canView = myRoles.some((r) => (VIEW_APPEALS_ROLES as readonly string[]).includes(r)) || isGlobalRegistrationPosition(myRoles, smoPosition, anusmoPosition);
  if (!canView) {
    redirect(adminLandingHrefForRoles(myRoles, session?.user?.hasStaffPosition, smoPosition, anusmoPosition));
  }

  return <AppealsClient />;
}
