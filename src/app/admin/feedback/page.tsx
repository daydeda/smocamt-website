import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { adminLandingHrefForRoles, effectiveRoles } from "@/lib/admin-access";
import { isFeedbackManagerAny } from "@/lib/feedback-access";
import { FeedbackAdminClient } from "./FeedbackAdminClient";

export const dynamic = "force-dynamic";

// The /admin layout already gates entry broadly (super_admin/admin/
// registration/organizer + scanner-only roles). This page is further
// restricted to FEEDBACK_MANAGER_ROLES (src/lib/feedback-access.ts) —
// deliberately narrower than most admin areas, since registration/organizer
// can themselves be the subject of a Staff Conduct or Harassment complaint
// (docs/features/feedback-complaints.md §6). Reused here (not re-hardcoded)
// so this redirect can't drift from the GET/PATCH /api/admin/feedback gate.
export default async function AdminFeedbackPage() {
  const session = await auth();
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  if (!isFeedbackManagerAny(myRoles)) {
    redirect(adminLandingHrefForRoles(myRoles, session?.user?.hasStaffPosition, session?.user?.smoPosition, session?.user?.anusmoPosition));
  }

  return <FeedbackAdminClient />;
}
