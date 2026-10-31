import { db } from "@/db";
import { clubMembers, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isGlobalRegistrationPosition } from "@/lib/access/admin-access";

export type PresidentScope = {
  clubIds: string[];
  majors: string[];
};

type ScopedEvent = {
  ownerClubIds?: string[] | null;
  ownerMajors?: string[] | null;
};

export class EventScopeService {
  /**
   * Resolves a president's identity scope: which clubs they preside over (from
   * club_members) and which major they represent (their own users.major — majors
   * are a fixed set, so no separate assignment exists). Roles outside
   * club_president/major_president resolve to an empty scope.
   */
  static async getPresidentScope(userId: string, roles: string[]): Promise<PresidentScope> {
    const clubIds: string[] = [];
    const majors: string[] = [];

    if (roles.includes("club_president")) {
      const memberships = await db.query.clubMembers.findMany({
        where: and(eq(clubMembers.userId, userId), eq(clubMembers.role, "president")),
        columns: { clubId: true },
      });
      clubIds.push(...memberships.map((m) => m.clubId));
    }

    if (roles.includes("major_president")) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { major: true },
      });
      if (user?.major) majors.push(user.major);
    }

    return { clubIds, majors };
  }

  /**
   * Single-event gate for attendance/export/report/scan/scan-count: does this
   * president's scope own the event? Requires a NON-EMPTY matching owner list —
   * an event with managedByRoles including a president role but no ownerClubIds/
   * ownerMajors assigned yet is "unassigned" and stays hidden from every president
   * until staff assigns an owner. Staff/admin bypass happens at the call site,
   * before this is ever invoked.
   */
  static isEventManagedByScope(event: ScopedEvent, scope: PresidentScope): boolean {
    const clubMatch = (event.ownerClubIds ?? []).some((id) => scope.clubIds.includes(id));
    const majorMatch = (event.ownerMajors ?? []).some((m) => scope.majors.includes(m));
    return clubMatch || majorMatch;
  }

  /** List-filter variant of isEventManagedByScope, for the events list route. */
  static filterEventsByScope<T extends ScopedEvent>(events: T[], scope: PresidentScope): T[] {
    return events.filter((event) => EventScopeService.isEventManagedByScope(event, scope));
  }

  /**
   * Resolves scope for a "registration" title holder (the
   * global case replaces the retired registration role), now scoped per-context rather than a
   * single global users.position:
   *   - smoPosition === "registration" with the smo role -> global
   *     (scope.global = true), from the session (no extra query needed).
   *     anusmo + "registration" is check-in only (canCheckInEveryEvent), so
   *     it resolves to no scope here.
   *   - club_members rows with position="registration" -> scoped to
   *     specifically THOSE club(s)' events only (not every club the user
   *     happens to belong to — a "registration" title in Club A no longer
   *     leaks scope into Club B).
   *   - users.majorPosition === "registration" -> scoped to their own
   *     major's events only.
   * A user can match more than one of these at once (e.g. registration in
   * one club AND their major team); all matching scopes are unioned. Holding
   * none of these resolves to an empty, non-global scope.
   */
  static async getRegistrationPositionScope(
    userId: string,
    roles: string[],
    smoPosition: string | null | undefined,
    anusmoPosition: string | null | undefined,
  ): Promise<{ global: boolean } & PresidentScope> {
    // The ANUSMO registration desk is check-in only (canCheckInEveryEvent), not global.
    const isGlobal = isGlobalRegistrationPosition(roles, smoPosition, anusmoPosition);
    if (isGlobal) return { global: true, clubIds: [], majors: [] };

    const memberships = await db.query.clubMembers.findMany({
      where: and(eq(clubMembers.userId, userId), eq(clubMembers.position, "registration")),
      columns: { clubId: true },
    });

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { major: true, majorPosition: true },
    });
    const majors = user?.majorPosition === "registration" && user.major ? [user.major] : [];

    return { global: false, clubIds: memberships.map((m) => m.clubId), majors };
  }

  /**
   * True iff this user holds a "registration" title in ANY scope (global
   * smo/anusmo, a specific club, or their major) — the boolean callers need
   * for a bare "does a scoped-registration check apply at all" branch before
   * deciding whether to run the fuller resolveEventAccess/isEventManagedByScope
   * dance. Replaces the old single `position === "registration"` string
   * comparison those call sites used pre-split.
   */
  static async hasRegistrationScope(
    userId: string,
    roles: string[],
    smoPosition: string | null | undefined,
    anusmoPosition: string | null | undefined,
  ): Promise<boolean> {
    const scope = await EventScopeService.getRegistrationPositionScope(userId, roles, smoPosition, anusmoPosition);
    return scope.global || scope.clubIds.length > 0 || scope.majors.length > 0;
  }

  /**
   * Combined access resolver for event-scoped routes, replacing the
   * duplicated "isUnscopedStaff / getPresidentScope" boilerplate at each call
   * site. `isUnscopedStaff` and `hasPresidentTag` stay each route's own
   * existing role-array checks; a global registration position resolves to
   * unscoped here even when the caller passes isUnscopedStaff = false.
   */
  static async resolveEventAccess(params: {
    userId: string;
    roles: string[];
    smoPosition: string | null | undefined;
    anusmoPosition: string | null | undefined;
    isUnscopedStaff: boolean;
    hasPresidentTag: boolean;
  }): Promise<
    | { allowed: false }
    | { allowed: true; unscoped: true }
    | { allowed: true; unscoped: false; scope: PresidentScope }
  > {
    if (params.isUnscopedStaff) return { allowed: true, unscoped: true };

    const reg = await EventScopeService.getRegistrationPositionScope(
      params.userId,
      params.roles,
      params.smoPosition,
      params.anusmoPosition,
    );
    if (reg.global) return { allowed: true, unscoped: true };

    const pres = params.hasPresidentTag
      ? await EventScopeService.getPresidentScope(params.userId, params.roles)
      : { clubIds: [], majors: [] };

    const hasRegistrationScope = reg.clubIds.length > 0 || reg.majors.length > 0;
    if (!params.hasPresidentTag && !hasRegistrationScope) {
      return { allowed: false };
    }

    return {
      allowed: true,
      unscoped: false,
      scope: {
        clubIds: [...pres.clubIds, ...reg.clubIds],
        majors: [...pres.majors, ...reg.majors],
      },
    };
  }
}
