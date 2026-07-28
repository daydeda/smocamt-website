import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { headers } from "next/headers"
import { db } from "@/db"
import { accounts, sessions, users, verificationTokens, clubMembers } from "@/db/schema"
import { eq, and, isNotNull } from "drizzle-orm"
import { AuditService } from "@/modules/audit/audit.service"
import { isSiteMoved } from "@/lib/site-moved"
import { isRemoteDatabase } from "@/db/guard"

// Fail fast at runtime if AUTH_URL is missing in production: with trustHost:true an
// unset AUTH_URL lets Auth.js derive the OAuth callback host from the request Host
// header (host-header injection / callback redirection). Skipped during `next build`
// (NEXT_PHASE), where runtime env vars aren't provided yet.
//
// Also skipped on the retired "we've moved" deploy: that deployment intentionally has
// no AUTH_URL/DB env, and the edge proxy imports this module on EVERY request — so a
// throw here at module-load crashed the whole site with a bare 500 (no Content-Type),
// which browsers download instead of render, and the moved notice never got to run.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !isSiteMoved() &&
  !process.env.AUTH_URL
) {
  throw new Error(
    "AUTH_URL must be set in production (trustHost:true relies on it; otherwise the OAuth callback host comes from the Host header)."
  )
}

// Comma-separated list in the SUPER_ADMIN_EMAILS env var. No hardcoded fallback: a
// personal address baked into source is a config landmine (and a non-@cmu.ac.th
// account). Existing super_admins already hold the role in the DB; set this env var
// (Portainer) to keep auto-promoting official accounts on sign-in.
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ROLE_PRIORITY = ["super_admin", "admin", "registration", "organizer", "smo", "anusmo", "club_president", "major_president", "staff", "professor", "officer", "student"];
// Sign-ins by these roles are audit-logged. Students are deliberately NOT
// logged — hundreds of sign-ins a day would just flood the audit table.
const AUDITED_SIGNIN_ROLES = ["super_admin", "admin", "registration", "organizer"];
// How often the session is re-hydrated from the DB to pick up role/profile/house
// changes made elsewhere (e.g. an admin assigning a role). This refresh lives in
// the `jwt` callback so the timestamp PERSISTS to the cookie — meaning it runs at
// most once per interval per user. (It used to live in the `session` callback,
// where token mutations are silently discarded, so it re-queried the DB on EVERY
// request after the first 5 min — a big standing load with hundreds of pollers.)
const DB_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

function getPrimaryRole(roles: string[] | null | undefined, fallbackRole: string | null | undefined): string {
  const list = roles && Array.isArray(roles) && roles.length > 0 ? roles : (fallbackRole ? [fallbackRole] : ["student"]);
  const primary = ROLE_PRIORITY.find(r => list.includes(r));
  return primary || list[0] || "student";
}

/** Fetch all user fields needed for the session from DB */
async function fetchUserDataFromDb(userId: string) {
  const dbUser = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: {
      name: true,
      image: true,
      role: true,
      roles: true,
      email: true,
      profileCompleted: true,
      houseId: true,
      imageTransform: true,
      qrToken: true,
      studentId: true,
      majorPosition: true,
      smoPosition: true,
      anusmoPosition: true,
    },
  });
  if (!dbUser) return null;

  // Precomputed here (rather than at every canEnterAdminAny call site) so the
  // edge proxy — which only ever reads the session, never queries the DB
  // directly — can gate confined /admin entry for a plain club staff-title
  // holder without a round trip. See src/lib/admin-access.ts.
  const clubPositionRow = await db.query.clubMembers.findFirst({
    where: and(eq(clubMembers.userId, userId), isNotNull(clubMembers.position)),
    columns: { id: true },
  });

  // Same idea, narrowed to specifically the "registration" title (see
  // src/lib/positions.ts) in ANY club — lets client pages (e.g. admin/events)
  // grant this specific holder the same event-scoped form-management rights
  // EventScopeService.hasRegistrationScope already grants server-side, without
  // a per-page club_members round trip. The smo/anusmo-global case is already
  // covered by session smoPosition/anusmoPosition (see
  // isGlobalRegistrationPosition); the major case by session.majorPosition —
  // neither needs a new field, only this club-scoped one does.
  const clubRegistrationPositionRow = await db.query.clubMembers.findFirst({
    where: and(eq(clubMembers.userId, userId), eq(clubMembers.position, "registration")),
    columns: { id: true },
  });

  return {
    ...dbUser,
    hasClubPosition: !!clubPositionRow,
    hasClubRegistrationPosition: !!clubRegistrationPositionRow,
  };
}

type DbUser = NonNullable<Awaited<ReturnType<typeof fetchUserDataFromDb>>>;

/**
 * Copy fresh DB user fields onto the JWT token. Generates a qrToken if one is
 * missing, applies role priority, and forces super_admin for official emails.
 * Returns the (possibly newly generated) qrToken so the caller can persist it.
 */
async function applyDbUserToToken(token: Record<string, unknown>, dbUser: DbUser, userId: string) {
  let qrToken = dbUser.qrToken;
  if (!qrToken) {
    qrToken = crypto.randomUUID();
    await db.update(users).set({ qrToken }).where(eq(users.id, userId));
  }

  const userRoles = (dbUser.roles as string[]) || (dbUser.role ? [dbUser.role] : ["student"]);

  token.name = dbUser.name;
  token.image = dbUser.image;
  token.email = dbUser.email;
  token.role = getPrimaryRole(userRoles, dbUser.role);
  token.roles = userRoles;
  token.profileCompleted = dbUser.profileCompleted ?? false;
  token.houseId = dbUser.houseId ?? null;
  token.imageTransform = dbUser.imageTransform ?? null;
  token.qrToken = qrToken;
  token.studentId = dbUser.studentId ?? null;
  token.majorPosition = dbUser.majorPosition ?? null;
  token.smoPosition = dbUser.smoPosition ?? null;
  token.anusmoPosition = dbUser.anusmoPosition ?? null;
  token.hasClubPosition = dbUser.hasClubPosition;
  token.hasClubRegistrationPosition = dbUser.hasClubRegistrationPosition;
  token.hasStaffPosition = !!(dbUser.majorPosition || dbUser.smoPosition || dbUser.anusmoPosition || dbUser.hasClubPosition);

  const currentEmail = (dbUser.email || "").toLowerCase();
  if (SUPER_ADMIN_EMAILS.includes(currentEmail)) {
    token.role = "super_admin";
    token.roles = ["super_admin"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Trust the host header for callback-URL construction. Required for non-Vercel
  // deploys (Docker / university server) where Auth.js can't auto-detect the host;
  // a wrong host breaks the OAuth round-trip and surfaces as an InvalidCheck/PKCE
  // failure. On Vercel this is already implied. AUTH_URL (prod) must still match
  // the live domain exactly — apex vs www — and Google's redirect URI must be
  // https://<domain>/api/auth/callback/google.
  trustHost: true,
  // 7 days instead of NextAuth's 30-day default: a stolen cookie on a shared
  // or lost device stays valid for a week, not a month, while inactive
  // students don't have to re-login daily between events.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  // Auth.js's default cookie names (authjs.session-token, etc.) carry no
  // per-app namespace — cookies are scoped by hostname+path only, NOT port,
  // so ActiveCAMT (localhost:3001) and Songsue (localhost:3000) running side
  // by side in local dev silently share/overwrite ONE browser cookie. Both
  // repos' .env.local also happen to hold the same AUTH_SECRET, so the JWT
  // still decodes "successfully" in whichever app didn't set it last — just
  // pointing at a user id from the OTHER app's (entirely separate) database.
  // That's what a stale/missing-row session and "editing my profile on
  // Songsue signs me out of ActiveCAMT too" both trace back to: signOut()
  // clears the one cookie slot both apps were reading. Namespacing every
  // cookie name here (only `name` is overridden — merge() deep-merges this
  // onto Auth.js's default per-cookie `options`, so httpOnly/sameSite/secure
  // stay correct) makes the two apps' sessions fully independent in the same
  // browser. Only `name` differs from Auth.js's defaults (see defaultCookies
  // in @auth/core/lib/utils/cookie.js) — never copy the `options` shape here
  // by hand, since `secure` depends on the request's protocol at runtime.
  cookies: {
    sessionToken: { name: "activecamt.session-token" },
    callbackUrl: { name: "activecamt.callback-url" },
    csrfToken: { name: "activecamt.csrf-token" },
    pkceCodeVerifier: { name: "activecamt.pkce.code_verifier" },
    state: { name: "activecamt.state" },
    nonce: { name: "activecamt.nonce" },
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
      // Force the Google account chooser on every sign-in. Without this, Google can
      // complete silently (prompt=none) for users with an existing session — which,
      // for people signed into MANY Google accounts (authuser=N), races/ mismatches
      // the short-lived PKCE+state check cookie and surfaces as "Sign-in didn't
      // complete / session expired" at /api/auth/callback/google. Forcing an
      // interactive selection makes each sign-in plant a fresh, matching cookie.
      authorization: { params: { prompt: "select_account" } },
    }),
    ...(process.env.NODE_ENV === "development" && process.env.ENABLE_DEV_LOGIN === "true"
      ? [
          Credentials({
            name: "Dev Bypass Login",
            credentials: {
              email: { label: "Email", type: "email" },
              name: { label: "Name", type: "text" },
              role: { label: "Role", type: "text" },
            },
            async authorize(credentials) {
              const dbUrl = process.env.DATABASE_URL ?? "";
              if (isRemoteDatabase(dbUrl)) {
                console.warn(
                  "⛔ Refusing Dev Bypass Login: DATABASE_URL looks like a remote/production database."
                );
                return null;
              }

              const role = credentials?.role as string || "super_admin";
              const DEV_ROLE_ALLOWLIST = ["student", "smo", "club_president", "admin", "super_admin"];
              if (!DEV_ROLE_ALLOWLIST.includes(role)) {
                console.warn(`⛔ Refusing Dev Bypass Login: Role "${role}" is not in the allowlist.`);
                return null;
              }

              const email = (credentials?.email as string || "dev-superadmin@localhost.test").toLowerCase();
              const name = credentials?.name as string || "Dev User";

              let user = await db.query.users.findFirst({
                where: (u, { eq }) => eq(u.email, email),
              });

              if (!user) {
                const newUserId = crypto.randomUUID();
                await db.insert(users).values({
                  id: newUserId,
                  name,
                  email,
                  role,
                  roles: [role],
                  houseId: "red",
                  profileCompleted: true,
                  qrToken: crypto.randomUUID(),
                });
                user = await db.query.users.findFirst({
                  where: (u, { eq }) => eq(u.email, email),
                });
              }

              return {
                id: user!.id,
                name: user!.name ?? null,
                email: user!.email,
                role: role,
                roles: [role],
                profileCompleted: user!.profileCompleted ?? false,
                houseId: user!.houseId ?? null,
                imageTransform: (user!.imageTransform as { scale: number; x: number; y: number } | null) ?? null,
                qrToken: user!.qrToken ?? null,
                studentId: user!.studentId ?? null,
                majorPosition: user!.majorPosition ?? null,
                smoPosition: user!.smoPosition ?? null,
                anusmoPosition: user!.anusmoPosition ?? null,
                hasClubPosition: false,
                hasClubRegistrationPosition: false,
                hasStaffPosition: !!(user!.majorPosition || user!.smoPosition || user!.anusmoPosition),
                image: user!.image ?? null,
                isDevBypass: true,
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    // FE-01: Restrict login to @cmu.ac.th email domain only
    async signIn({ user }) {
      const email = user.email ?? "";

      // Auto-promote official emails to super_admin (FE-04)
      if (SUPER_ADMIN_EMAILS.includes(email.toLowerCase())) {
        await db.update(users)
          .set({ role: "super_admin", roles: ["super_admin"] })
          .where(eq(users.email, email));
      }

      // Ensure every user has a qrToken (FE-13)
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { qrToken: true, id: true }
      });

      if (existingUser && !existingUser.qrToken) {
        await db.update(users)
          .set({ qrToken: crypto.randomUUID() })
          .where(eq(users.id, existingUser.id));
      }

      return true;
    },

    async jwt({ token, user, trigger }) {
      // On sign-in: hydrate the token with all user data from DB
      if (user) {
        token.id = user.id;
        const isBypass = (user as { isDevBypass?: boolean }).isDevBypass;
        if (isBypass) {
          token.isDevBypass = true;
          token.role = user.role;
          token.roles = user.roles;
          const dbUser = await fetchUserDataFromDb(user.id as string);
          if (dbUser) {
            token.name = dbUser.name;
            token.image = dbUser.image;
            token.email = dbUser.email;
            token.profileCompleted = dbUser.profileCompleted ?? false;
            token.houseId = dbUser.houseId ?? null;
            token.imageTransform = dbUser.imageTransform ?? null;
            token.qrToken = dbUser.qrToken;
            token.studentId = dbUser.studentId ?? null;
            token.majorPosition = dbUser.majorPosition ?? null;
    token.smoPosition = dbUser.smoPosition ?? null;
    token.anusmoPosition = dbUser.anusmoPosition ?? null;
    token.hasClubPosition = dbUser.hasClubPosition;
    token.hasClubRegistrationPosition = dbUser.hasClubRegistrationPosition;
    token.hasStaffPosition = !!(dbUser.majorPosition || dbUser.smoPosition || dbUser.anusmoPosition || dbUser.hasClubPosition);
          }
        } else {
          const dbUser = await fetchUserDataFromDb(user.id as string);
          if (dbUser) await applyDbUserToToken(token, dbUser, user.id as string);
        }
        token.lastDbRefresh = Date.now();
        return token;
      }

      const userId = (token.id || token.sub) as string;
      const isBypass = token.isDevBypass;

      // On explicit update trigger (e.g. user just completed their profile): force
      // an immediate DB refresh. Persists because we're in the jwt callback.
      if (trigger === "update" && userId) {
        token.updateTime = Date.now();
        const dbUser = await fetchUserDataFromDb(userId);
        if (dbUser) {
          if (isBypass) {
            token.name = dbUser.name;
            token.image = dbUser.image;
            token.email = dbUser.email;
            token.profileCompleted = dbUser.profileCompleted ?? false;
            token.houseId = dbUser.houseId ?? null;
            token.imageTransform = dbUser.imageTransform ?? null;
            token.qrToken = dbUser.qrToken;
            token.studentId = dbUser.studentId ?? null;
            token.majorPosition = dbUser.majorPosition ?? null;
    token.smoPosition = dbUser.smoPosition ?? null;
    token.anusmoPosition = dbUser.anusmoPosition ?? null;
    token.hasClubPosition = dbUser.hasClubPosition;
    token.hasClubRegistrationPosition = dbUser.hasClubRegistrationPosition;
    token.hasStaffPosition = !!(dbUser.majorPosition || dbUser.smoPosition || dbUser.anusmoPosition || dbUser.hasClubPosition);
          } else {
            await applyDbUserToToken(token, dbUser, userId);
          }
        }
        token.lastDbRefresh = Date.now();
        return token;
      }

      // Eager refresh while onboarding is incomplete. A brand-new user's token has
      // profileCompleted=false; after they submit the onboarding form we must NOT
      // depend on the client's update() call landing before it navigates (a race).
      // Instead, every request re-reads the DB *until* the profile is complete, so
      // the navigation to /dashboard itself picks up profileCompleted=true plus the
      // assigned house/role and persists them. Self-limiting: once the flag flips
      // true this path stops firing and we fall back to the periodic refresh below.
      const profileIncomplete = !token.profileCompleted;

      // Periodic refresh: re-hydrate from DB at most once per interval to pick up
      // role/profile/house changes made elsewhere. The new lastDbRefresh persists
      // to the cookie, so this does NOT re-query on every subsequent request.
      const lastRefresh = (token.lastDbRefresh as number) || 0;
      const periodicDue = Date.now() - lastRefresh > DB_REFRESH_INTERVAL_MS;

      if (userId && (profileIncomplete || periodicDue)) {
        const dbUser = await fetchUserDataFromDb(userId);
        if (dbUser) {
          if (isBypass) {
            token.name = dbUser.name;
            token.image = dbUser.image;
            token.email = dbUser.email;
            token.profileCompleted = dbUser.profileCompleted ?? false;
            token.houseId = dbUser.houseId ?? null;
            token.imageTransform = dbUser.imageTransform ?? null;
            token.qrToken = dbUser.qrToken;
            token.studentId = dbUser.studentId ?? null;
            token.majorPosition = dbUser.majorPosition ?? null;
    token.smoPosition = dbUser.smoPosition ?? null;
    token.anusmoPosition = dbUser.anusmoPosition ?? null;
    token.hasClubPosition = dbUser.hasClubPosition;
    token.hasClubRegistrationPosition = dbUser.hasClubRegistrationPosition;
    token.hasStaffPosition = !!(dbUser.majorPosition || dbUser.smoPosition || dbUser.anusmoPosition || dbUser.hasClubPosition);
          } else {
            await applyDbUserToToken(token, dbUser, userId);
          }
        }
        token.lastDbRefresh = Date.now();
      }

      return token;
    },

    async session({ session, token }) {
      const userId = (token.id || token.sub) as string;
      if (userId) {
        session.user.id = userId;
      } else {
        return session; // No user ID, can't populate session
      }

      // Pure mapping from the (already-fresh) JWT token — no DB query here. All DB
      // refresh logic lives in the jwt callback above so its writes persist.
      session.user.name = (token.name as string) ?? session.user.name;
      session.user.image = (token.image as string) ?? session.user.image;
      session.user.email = (token.email as string) ?? session.user.email;
      session.user.roles = (token.roles as string[]) ?? ["student"];
      session.user.role = (token.role as string) ?? "student";
      session.user.profileCompleted = (token.profileCompleted as boolean) ?? false;
      session.user.houseId = (token.houseId as string) ?? null;
      session.user.imageTransform = (token.imageTransform as { scale: number; x: number; y: number } | null) ?? null;
      session.user.qrToken = (token.qrToken as string) ?? null;
      session.user.studentId = (token.studentId as string) ?? null;
      session.user.majorPosition = (token.majorPosition as string | null) ?? null;
      session.user.smoPosition = (token.smoPosition as string | null) ?? null;
      session.user.anusmoPosition = (token.anusmoPosition as string | null) ?? null;
      session.user.hasClubPosition = (token.hasClubPosition as boolean) ?? false;
      session.user.hasClubRegistrationPosition = (token.hasClubRegistrationPosition as boolean) ?? false;
      session.user.hasStaffPosition = (token.hasStaffPosition as boolean) ?? false;

      // Force super_admin role for the official emails - CASE INSENSITIVE (FE-04)
      const currentEmail = (session.user?.email || "").toLowerCase();
      if (SUPER_ADMIN_EMAILS.includes(currentEmail)) {
        session.user.role = "super_admin";
        session.user.roles = ["super_admin"];
      }

      return session;
    },
  },
  events: {
    // Audit admin-level sign-ins (fires once per OAuth sign-in, after the
    // signIn callback above — so the role read here includes any auto-promotion).
    // Runs inside the existing callback request: no extra function invocation.
    async signIn({ user }) {
      try {
        if (!user?.id) return;
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id),
          columns: { name: true, role: true, roles: true },
        });
        if (!dbUser) return;
        const primaryRole = getPrimaryRole(dbUser.roles as string[] | null, dbUser.role);
        if (!AUDITED_SIGNIN_ROLES.includes(primaryRole)) return;

        let ipAddress = "unknown";
        try {
          const h = await headers();
          // Prefer the un-spoofable X-Real-IP (nginx overwrites it); fall back to
          // the LAST X-Forwarded-For hop (the real IP nginx appends), never the
          // client-supplied leftmost entry. Mirrors getClientIp in audit.service.ts.
          const realIp = h.get("x-real-ip")?.trim();
          const xffHops = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
          ipAddress = realIp || xffHops?.[xffHops.length - 1] || "unknown";
        } catch {
          // headers() can throw outside a request scope; keep "unknown"
        }

        await AuditService.logAction({
          actorId: user.id,
          action: `Admin sign-in: ${dbUser.name} (${primaryRole})`,
          ipAddress,
        });
      } catch (err) {
        // Never block a sign-in because audit logging failed
        console.error("Failed to audit admin sign-in:", err);
      }
    },
  },
  pages: {
    // Use our own sign-in page at /login
    signIn: "/login",
    error: "/login",
  },
})