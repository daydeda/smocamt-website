import { auth } from "@/auth";
import {
  canAwardPrizes,
  canManagePrizes,
  canExportPrizeReport,
  effectiveRoles,
} from "@/lib/admin-access";
import { EventScopeService, type PresidentScope } from "@/modules/events/event-scope.service";
import { db } from "@/db";

// Server-side gate for every prize route. admin-access.ts answers "may this
// ROLE at all" (it must stay pure for the edge proxy); this answers "and which
// prizes", which needs the DB.
//
// Layered like the rest of /admin: the proxy and AdminNav only decide what is
// visible — these checks are what actually protect the data.

export interface PrizeAccess {
  userId: string;
  roles: string[];
  /** May scan + confirm a handover. Includes smo. */
  canAward: boolean;
  /** May create/configure a prize and see its full claim list. Excludes smo. */
  canManage: boolean;
  /** May generate the dean report (.xlsx / print page). Excludes smo. */
  canExport: boolean;
  /** super_admin: the only role that may delete a photo or revoke a claim. */
  isSuperAdmin: boolean;
  /**
   * null = unscoped (sees every prize). Otherwise the president's club/major
   * scope, matched against the owning event's ownerClubIds/ownerMajors by
   * canReachPrize — the same ownership test the events, attendance and appeals
   * routes already use, rather than a second notion of ownership.
   */
  scope: PresidentScope | null;
}

const UNSCOPED_ROLES = ["super_admin", "admin", "registration", "organizer"];

export async function resolvePrizeAccess(): Promise<PrizeAccess | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const roles = effectiveRoles(session.user.role, session.user.roles);
  if (!canAwardPrizes(roles) && !canManagePrizes(roles)) return null;

  const unscoped = roles.some((r) => UNSCOPED_ROLES.includes(r));

  // smo is unscoped-but-award-only: it staffs whichever prize table it is sent
  // to and owns no events, so scoping it by ownership would leave it with
  // nothing. Its narrowing is canManage/canExport being false, not the event
  // allow-list.
  const isSmoOnly = !unscoped && roles.includes("smo") &&
    !roles.some((r) => ["club_president", "major_president"].includes(r));

  const scope = unscoped || isSmoOnly
    ? null
    : await EventScopeService.getPresidentScope(session.user.id, roles);

  return {
    userId: session.user.id,
    roles,
    canAward: canAwardPrizes(roles),
    canManage: canManagePrizes(roles),
    canExport: canExportPrizeReport(roles),
    isSuperAdmin: roles.includes("super_admin"),
    scope,
  };
}

/**
 * May this access reach this specific prize? A scoped president is limited to
 * prizes attached to an event they own; a prize with NO event is "central" and
 * unscoped-only, mirroring the shop's "no owner = central" rule.
 */
export async function canReachPrize(
  access: PrizeAccess,
  prize: { eventId: string | null; eligibilityEventId?: string | null },
): Promise<boolean> {
  if (access.scope === null) return true;

  // A prize attached to no event is "central" — unscoped roles only, mirroring
  // the shop's "no owner = central" rule. A president must not be able to reach
  // a faculty-wide giveaway just because they preside over something else.
  const candidateIds = [prize.eventId, prize.eligibilityEventId ?? null].filter(
    (id): id is string => !!id,
  );
  if (candidateIds.length === 0) return false;

  const owning = await db.query.events.findMany({
    where: (e, { inArray }) => inArray(e.id, candidateIds),
    columns: { id: true, ownerClubIds: true, ownerMajors: true },
  });
  return owning.some((e) => EventScopeService.isEventManagedByScope(e, access.scope!));
}
