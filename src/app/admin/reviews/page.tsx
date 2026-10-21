import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { adminLandingHrefForRoles, effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/events/event-proposals";
import { PendingReviewsClient } from "./PendingReviewsClient";

export const dynamic = "force-dynamic";

// Staff-only aggregate view of everything a club_president/major_president has
// submitted that's awaiting staff review (pending Feedback Forms + pending
// event detail edits — see GET /api/admin/reviews). Gated the same way
// /admin/proposals is: REVIEW_PROPOSAL_ROLES, reused here so the redirect
// can't drift from the API's actual gate.
export default async function AdminReviewsPage() {
  const session = await auth();
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const smoPosition = session?.user?.smoPosition;
  const anusmoPosition = session?.user?.anusmoPosition;
  const canReview = myRoles.some((r) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(r))
    || isGlobalRegistrationPosition(myRoles, smoPosition, anusmoPosition);
  if (!canReview) {
    redirect(adminLandingHrefForRoles(myRoles, session?.user?.hasStaffPosition, smoPosition, anusmoPosition));
  }

  return <PendingReviewsClient />;
}
