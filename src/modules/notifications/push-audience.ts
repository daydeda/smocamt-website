// Resolves WHO should be pushed for a given staff-facing trigger, by reusing
// the exact role/scope predicates that already gate each admin surface (see
// docs/features/push-notifications.md "Phase 1 — final scope") — a push
// audience must never diverge from who can actually see the item in the UI.
//
// These queries deliberately scan the full `users` table rather than
// filtering roles in SQL: `role`/`roles[]` can diverge (a user's authoritative
// roles sometimes live only in the `roles` jsonb array — see effectiveRoles),
// and this codebase has no existing, verified jsonb-role SQL predicate to
// build on. A single faculty's user table is small and this only runs on
// infrequent staff-facing write paths (never a hot path), so correctness
// beats a marginal query optimization here.

import { db } from "@/db";
import { clubMembers, shopProducts, shopSellers, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { effectiveRoles, isGlobalRegistrationPosition, isShopFinancePosition } from "@/lib/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/event-proposals";
import { VIEW_APPEALS_ROLES } from "@/lib/strikes";
import { FEEDBACK_MANAGER_ROLES } from "@/lib/feedback-access";

type StaffRow = {
  id: string;
  role: string | null;
  roles: string[] | null;
  smoPosition: string | null;
  anusmoPosition: string | null;
};

async function allUsersForRoleCheck(): Promise<StaffRow[]> {
  return db
    .select({
      id: users.id,
      role: users.role,
      roles: users.roles,
      smoPosition: users.smoPosition,
      anusmoPosition: users.anusmoPosition,
    })
    .from(users);
}

/** User ids holding ANY of the given roles, via the same role∪roles[] merge as effectiveRoles(). */
export async function getUserIdsWithAnyRole(candidateRoles: readonly string[]): Promise<string[]> {
  const rows = await allUsersForRoleCheck();
  const set = new Set(candidateRoles);
  return rows.filter((r) => effectiveRoles(r.role, r.roles).some((role) => set.has(role))).map((r) => r.id);
}

/** Reviewer audience for a new event proposal — mirrors GET /api/admin/event-proposals exactly. */
export async function getProposalReviewerUserIds(): Promise<string[]> {
  const rows = await allUsersForRoleCheck();
  return rows
    .filter((r) => {
      const roles = effectiveRoles(r.role, r.roles);
      return (
        roles.some((role) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(role)) ||
        isGlobalRegistrationPosition(roles, r.smoPosition, r.anusmoPosition)
      );
    })
    .map((r) => r.id);
}

/** Unscoped shop-admin audience — mirrors isShopAdmin() in src/lib/shop-auth.ts. */
export async function getShopAdminUserIds(): Promise<string[]> {
  const rows = await allUsersForRoleCheck();
  return rows
    .filter((r) => {
      const roles = effectiveRoles(r.role, r.roles);
      return roles.includes("super_admin") || roles.includes("admin") || isShopFinancePosition(roles, r.smoPosition);
    })
    .map((r) => r.id);
}

/** Feedback-manager audience — mirrors isFeedbackManagerAny() in src/lib/feedback-access.ts. */
export async function getFeedbackManagerUserIds(): Promise<string[]> {
  return getUserIdsWithAnyRole(FEEDBACK_MANAGER_ROLES);
}

/** club_members rows with role='president' for these clubs. */
export async function getClubPresidentUserIds(clubIds: string[]): Promise<string[]> {
  if (clubIds.length === 0) return [];
  const rows = await db
    .select({ userId: clubMembers.userId })
    .from(clubMembers)
    .where(and(inArray(clubMembers.clubId, clubIds), eq(clubMembers.role, "president")));
  return [...new Set(rows.map((r) => r.userId))];
}

/** Users whose major is one of these AND who hold major_president — mirrors MajorsService's isPresident check. */
export async function getMajorPresidentUserIds(majors: string[]): Promise<string[]> {
  if (majors.length === 0) return [];
  const rows = await db
    .select({ id: users.id, role: users.role, roles: users.roles, major: users.major })
    .from(users)
    .where(inArray(users.major, majors));
  return rows.filter((r) => effectiveRoles(r.role, r.roles).includes("major_president")).map((r) => r.id);
}

/** President(s) who own an event via ownerClubIds/ownerMajors — the reverse of EventScopeService.getPresidentScope. */
export async function getEventOwnerPresidentUserIds(event: {
  ownerClubIds?: string[] | null;
  ownerMajors?: string[] | null;
}): Promise<string[]> {
  const [clubPresidents, majorPresidents] = await Promise.all([
    getClubPresidentUserIds(event.ownerClubIds ?? []),
    getMajorPresidentUserIds(event.ownerMajors ?? []),
  ]);
  return [...new Set([...clubPresidents, ...majorPresidents])];
}

// VIEW_APPEALS_ROLES minus the two scoped president roles — those two are
// resolved per-appeal via getEventOwnerPresidentUserIds instead of notified
// globally (a president must only hear about appeals for events they own).
const GLOBAL_APPEAL_VIEWER_ROLES = (VIEW_APPEALS_ROLES as readonly string[]).filter(
  (r) => r !== "club_president" && r !== "major_president",
);

/** Audience for "a new no-show appeal was submitted": global viewers + the event's owning president(s), if any. */
export async function getAppealAudienceUserIds(
  event: { ownerClubIds?: string[] | null; ownerMajors?: string[] | null } | null,
): Promise<string[]> {
  const [globalIds, scopedIds] = await Promise.all([
    getUserIdsWithAnyRole(GLOBAL_APPEAL_VIEWER_ROLES),
    event ? getEventOwnerPresidentUserIds(event) : Promise.resolve([]),
  ]);
  return [...new Set([...globalIds, ...scopedIds])];
}

/**
 * Audience for "a new shop order was placed": unscoped shop admins always,
 * plus whichever president/seller owns the product(s) in the order — mirrors
 * how GET /api/admin/shop/orders surfaces an order to a scoped caller
 * (classifyOrdersByScope / isProductOwnedByScope), but resolved as "who owns
 * this order" rather than "does this one caller own it".
 */
export async function getShopOrderAudienceUserIds(productIds: string[], directSellerId: string | null): Promise<string[]> {
  const uniqueProductIds = [...new Set(productIds)];
  const [adminIds, productRows, directSellerRow] = await Promise.all([
    getShopAdminUserIds(),
    uniqueProductIds.length
      ? db
          .select({ ownerClubIds: shopProducts.ownerClubIds, ownerMajors: shopProducts.ownerMajors, sellerId: shopProducts.sellerId })
          .from(shopProducts)
          .where(inArray(shopProducts.id, uniqueProductIds))
      : Promise.resolve([]),
    directSellerId
      ? db.select({ userId: shopSellers.userId }).from(shopSellers).where(eq(shopSellers.id, directSellerId)).limit(1)
      : Promise.resolve([]),
  ]);

  const clubIds = [...new Set(productRows.flatMap((p) => p.ownerClubIds ?? []))];
  const majors = [...new Set(productRows.flatMap((p) => p.ownerMajors ?? []))];
  const productSellerIds = [...new Set(productRows.map((p) => p.sellerId).filter((id): id is string => !!id))];
  const allSellerIds = [...new Set([...productSellerIds, ...(directSellerId ? [directSellerId] : [])])];

  const [presidentClubIds, presidentMajorIds, sellerRows] = await Promise.all([
    getClubPresidentUserIds(clubIds),
    getMajorPresidentUserIds(majors),
    allSellerIds.length
      ? db.select({ userId: shopSellers.userId }).from(shopSellers).where(inArray(shopSellers.id, allSellerIds))
      : Promise.resolve([]),
  ]);

  return [
    ...new Set([
      ...adminIds,
      ...presidentClubIds,
      ...presidentMajorIds,
      ...sellerRows.map((s) => s.userId),
      ...directSellerRow.map((s) => s.userId),
    ]),
  ];
}
