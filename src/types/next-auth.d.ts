import { DefaultSession, DefaultUser } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      roles: string[];
      profileCompleted: boolean;
      houseId: string | null;
      imageTransform: { scale: number; x: number; y: number } | null;
      qrToken: string | null;
      studentId: string | null;
      // Scoped staff titles (src/lib/positions.ts) — distinct from role/roles.
      // Replace the old single global `position` field: club titles live on
      // club_members.position (per club, not on the session), majorPosition/
      // smoPosition/anusmoPosition are scoped to the user's one major and to
      // holding the smo/anusmo role respectively (a user can hold both roles
      // at once with different titles in each). hasClubPosition/
      // hasStaffPosition are precomputed booleans (see src/auth.ts) so the
      // edge proxy never needs a DB round trip to answer "does this user hold
      // ANY / a club-scoped staff title" — used for admin-entry gating in
      // admin-access.ts. smoPosition/anusmoPosition feed
      // isGlobalRegistrationPosition there too.
      majorPosition: string | null;
      smoPosition: string | null;
      anusmoPosition: string | null;
      hasClubPosition: boolean;
      // True iff the user holds the "registration" TITLE (src/lib/positions.ts)
      // in at least one club (club_members.position — never on the session
      // itself, hence this precomputed flag). Distinct from the "registration"
      // ROLE and from the smo/anusmo-global case (already covered by
      // smoPosition/anusmoPosition + isGlobalRegistrationPosition) and the
      // major case (already covered by majorPosition) — neither of those needs
      // this field. Lets client pages grant the same event-scoped
      // form-management rights EventScopeService.hasRegistrationScope already
      // grants server-side, without a per-page club_members round trip.
      hasClubRegistrationPosition: boolean;
      hasStaffPosition: boolean;
    } & DefaultSession["user"]
  }

  interface User extends DefaultUser {
    id: string;
    role: string;
    roles: string[];
    profileCompleted: boolean;
    houseId: string | null;
    imageTransform: { scale: number; x: number; y: number } | null;
    qrToken: string | null;
    studentId: string | null;
    majorPosition: string | null;
    smoPosition: string | null;
    anusmoPosition: string | null;
    hasClubPosition: boolean;
    hasClubRegistrationPosition: boolean;
    hasStaffPosition: boolean;
  }
}
