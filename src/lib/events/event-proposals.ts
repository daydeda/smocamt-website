// Role constants for the club-president event-proposal flow. Mirrors the style
// of src/lib/strikes.ts.

// club_president submits a proposal scoped to a clubId; major_president submits
// one scoped to a majorCode instead (their own users.major — EventScopeService
// resolves majors[] for that role the same way it resolves clubIds[] for
// club_president; see event-scope.service.ts and eventProposals.majorCode in
// schema.ts). A proposal carries exactly one of clubId/majorCode, never both.
export const SUBMIT_PROPOSAL_ROLES = ["club_president", "major_president"] as const;

// Same staff set that may create a real event today (POST /api/admin/events) —
// reviewing/rejecting/converting a proposal is just "can create events" plus
// EventScopeService-based ownership scoping for president submissions.
export const REVIEW_PROPOSAL_ROLES = ["super_admin", "admin", "registration", "organizer"] as const;

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
