// Single source of truth for every admin-sidebar destination (sidebar +
// command palette). Mirrors src/lib/nav-config.ts's pattern (pure data + pure
// functions, no JSX) for the same reason: one array read by several
// renderers can't drift the way two hand-maintained lists can.
//
// Admin RBAC is materially richer than the student side's — visibility isn't
// a flat "allowed roles" list, it's a handful of bespoke per-item rules
// (scanner-only's multi-way OR, major_president's role-only bypass, etc.).
// `allowed` is therefore a predicate over AdminNavContext, and each item's
// predicate below is ported VERBATIM from the pre-refactor AdminNav.tsx's
// `itemAllowed` function — this is an access-control-adjacent surface, so
// behavior preservation matters more than tidiness. See
// admin-nav-config.test.ts for the truth-table test pinning this.
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Calendar,
  QrCode,
  Users,
  ShieldCheck,
  Megaphone,
  ShoppingBag,
  Building2,
  GraduationCap,
  MessageSquareWarning,
  MessagesSquare,
  BookOpen,
  ClipboardList,
  ListChecks,
} from "lucide-react";
import { isScannerOnlyAny, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/event-proposals";

export interface AdminNavContext {
  roles: string[];
  hasStaffPosition?: boolean;
  hasClubPosition?: boolean;
  smoPosition?: string | null;
  anusmoPosition?: string | null;
  /** Precomputed once (not re-derived per item) so every item shares one answer. */
  scannerOnly: boolean;
  /** Precomputed once — smo/anusmo holding the "registration" staff position. */
  globalReg: boolean;
}

// Builds the shared context both AdminNav and AdminCommandPalette read from,
// so there is exactly one computation of "who sees what" for this surface.
export function buildAdminNavContext(input: {
  roles: string[];
  hasStaffPosition?: boolean;
  hasClubPosition?: boolean;
  smoPosition?: string | null;
  anusmoPosition?: string | null;
}): AdminNavContext {
  return {
    ...input,
    scannerOnly: isScannerOnlyAny(input.roles, input.hasStaffPosition, input.smoPosition, input.anusmoPosition),
    globalReg: isGlobalRegistrationPosition(input.roles, input.smoPosition, input.anusmoPosition),
  };
}

export interface AdminNavItem {
  id: string;
  href: string;
  i18nKey: string;
  fallback: string;
  icon: LucideIcon;
  group: string;
  allowed: (ctx: AdminNavContext) => boolean;
  /** Extra command-palette search terms (synonyms) beyond the label itself. */
  keywords?: string[];
  /**
   * No real destination yet (VOC, Study — see the admin-nav redesign plan).
   * Renders as a disabled, non-navigating row with a "coming soon" badge in
   * both the sidebar and the palette — never a real <Link>. Flip off and set
   * a real href in the same diff that ships the module's actual admin page.
   */
  comingSoon?: boolean;
}

export interface AdminNavGroupDef {
  id: string;
  /** i18n key for the group's section heading; null = ungrouped (Overview). */
  titleI18nKey: string | null;
}

// Render order. A group with zero visible items is dropped entirely (see
// getVisibleAdminGroups) — same "empty groups disappear" behavior as
// nav-config.ts's getLauncherGroups. Feedback/Learning exist now so VOC/Study
// admin tooling has somewhere to land later without another IA pass; they
// start out holding only a comingSoon placeholder each.
export const ADMIN_NAV_GROUPS: AdminNavGroupDef[] = [
  { id: "overview", titleI18nKey: null },
  { id: "events", titleI18nKey: "navGroupEvents" },
  { id: "community", titleI18nKey: "navGroupCommunity" },
  { id: "content", titleI18nKey: "navGroupContent" },
  // i18n keys are admin-prefixed and distinct from the student launcher's
  // navGroupFeedback/navGroupLearning (src/lib/nav-config.ts, unmerged
  // sibling branch) even though the VALUES match (same taxonomy word on
  // both surfaces, deliberately) — this is what keeps the two branches'
  // i18n.ts insertions from landing in the same spot and conflicting,
  // regardless of which branch merges first.
  { id: "feedback", titleI18nKey: "adminNavGroupFeedback" },
  { id: "learning", titleI18nKey: "adminNavGroupLearning" },
  { id: "system", titleI18nKey: "navGroupSystem" },
];

// Shared predicates, computed once per item rather than inline, so the truth
// table in admin-nav-config.test.ts has stable names to assert against.
const has = (ctx: AdminNavContext, allowed: string[]) => ctx.roles.some((r) => allowed.includes(r));
const canSeeStudents = (ctx: AdminNavContext) => has(ctx, ["super_admin", "admin", "registration"]) || ctx.globalReg;
const canSeeAudit = (ctx: AdminNavContext) => has(ctx, ["super_admin", "admin"]);
const canManage = (ctx: AdminNavContext) => has(ctx, ["super_admin", "admin"]);
const canSeeClubs = (ctx: AdminNavContext) => has(ctx, ["super_admin", "admin"]);
const canReviewProposals = (ctx: AdminNavContext) => has(ctx, [...REVIEW_PROPOSAL_ROLES]) || ctx.globalReg;
// Coming-soon placeholders: shown only to the roles who'd eventually manage
// that module, so registration/organizer views stay exactly as narrow as
// they are today (no "heads up" noise for roles who couldn't act on it).
// Scanner-only contexts never reach this predicate at all — isAdminItemVisible
// short-circuits to scannerOnlyAllowed before `allowed` is ever called — so
// no explicit scannerOnly check is needed here. Revisit once VOC/Study land
// for real and pick up their own scoping.
const canSeeRoadmap = (ctx: AdminNavContext) => has(ctx, ["super_admin", "admin"]);

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    id: "overview",
    href: "/admin/dashboard",
    i18nKey: "overview",
    fallback: "Overview",
    icon: LayoutDashboard,
    group: "overview",
    // Ported from itemAllowed's default `return true` — dashboard is never
    // special-cased, every admin-entry role (incl. scanner-only) sees it.
    allowed: () => true,
  },

  // Events group.
  {
    id: "manageEvents",
    href: "/admin/events",
    i18nKey: "manageEvents",
    fallback: "Manage Events",
    icon: Calendar,
    group: "events",
    allowed: () => true, // default fallback, same as overview/scanner
  },
  {
    id: "qrScanner",
    href: "/admin/scanner",
    i18nKey: "qrScanner",
    fallback: "QR Scanner",
    icon: QrCode,
    group: "events",
    allowed: () => true,
  },
  {
    id: "manageProposals",
    href: "/admin/proposals",
    i18nKey: "manageProposals",
    fallback: "Event Proposals",
    icon: ClipboardList,
    group: "events",
    allowed: canReviewProposals,
  },
  {
    id: "pendingReviews",
    href: "/admin/reviews",
    i18nKey: "pendingReviews",
    fallback: "Pending Reviews",
    icon: ListChecks,
    group: "events",
    allowed: canReviewProposals,
  },
  {
    id: "manageAppeals",
    href: "/admin/appeals",
    i18nKey: "manageAppeals",
    fallback: "Appeals",
    icon: MessageSquareWarning,
    group: "events",
    allowed: canManage,
  },

  // Community group.
  {
    id: "manageClubs",
    href: "/admin/clubs",
    i18nKey: "manageClubs",
    fallback: "Manage Clubs",
    icon: Building2,
    group: "community",
    allowed: canSeeClubs,
  },
  {
    id: "manageMajors",
    href: "/admin/majors",
    i18nKey: "manageMajors",
    fallback: "Manage Majors",
    icon: GraduationCap,
    group: "community",
    // Ported verbatim: major_president-only, deliberately bypasses the
    // full-admin fallback (no staff-facing "majors directory" concept).
    allowed: (ctx) => ctx.roles.includes("major_president"),
  },
  {
    id: "adminStudentsDirectory",
    href: "/admin/students",
    i18nKey: "adminStudentsDirectory",
    fallback: "Students",
    icon: Users,
    group: "community",
    allowed: canSeeStudents,
  },

  // Content group.
  {
    id: "manageAnnouncement",
    href: "/admin/announcement",
    i18nKey: "manageAnnouncement",
    fallback: "Announcements",
    icon: Megaphone,
    group: "content",
    allowed: canManage,
  },
  {
    id: "manageShop",
    href: "/admin/shop",
    i18nKey: "manageShop",
    fallback: "Shop",
    icon: ShoppingBag,
    group: "content",
    allowed: canManage,
    keywords: ["store", "points", "redeem"],
  },

  // Feedback (VOC) shipped — see docs/features/feedback-complaints.md — real
  // route now, no longer comingSoon. Deliberately gated to canManage
  // (super_admin/admin only), NOT canSeeRoadmap's wider roadmap-preview
  // audience: registration/organizer can themselves be the subject of a
  // Staff Conduct or Harassment complaint, so this stays narrower than most
  // admin areas (docs §6). Study remains a roadmap placeholder below.
  {
    id: "voc",
    href: "/admin/feedback",
    i18nKey: "adminVocFeedback",
    fallback: "Feedback & Complaints",
    icon: MessagesSquare,
    group: "feedback",
    allowed: canManage,
  },
  {
    id: "study",
    href: "#",
    i18nKey: "adminStudyResources",
    fallback: "Study Resources",
    icon: BookOpen,
    group: "learning",
    allowed: canSeeRoadmap,
    comingSoon: true,
  },

  // System group.
  {
    id: "auditTrails",
    href: "/admin/audit-logs",
    i18nKey: "auditTrails",
    fallback: "Audit Logs",
    icon: ShieldCheck,
    group: "system",
    allowed: canSeeAudit,
  },
];

// scanner-only confinement applies ACROSS every item above — a scanner-only
// role sees only these hrefs regardless of what its own `allowed` predicate
// says, ported verbatim from itemAllowed's first branch (the nine-condition
// boolean that the full-admin path below never reaches).
function scannerOnlyAllowed(item: AdminNavItem, ctx: AdminNavContext): boolean {
  return (
    item.href === "/admin/scanner" ||
    item.href === "/admin/events" ||
    item.href === "/admin/appeals" ||
    (item.href === "/admin/clubs" && (ctx.roles.includes("club_president") || !!ctx.hasClubPosition)) ||
    (item.href === "/admin/majors" && ctx.roles.includes("major_president"))
  );
}

export function isAdminItemVisible(item: AdminNavItem, ctx: AdminNavContext): boolean {
  if (ctx.scannerOnly) return scannerOnlyAllowed(item, ctx);
  return item.allowed(ctx);
}

export interface AdminNavGroup extends AdminNavGroupDef {
  items: AdminNavItem[];
}

export function getVisibleAdminGroups(ctx: AdminNavContext): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: ADMIN_NAV_ITEMS.filter((item) => item.group === group.id && isAdminItemVisible(item, ctx)),
  })).filter((group) => group.items.length > 0);
}

// Flat visible-item list (palette search doesn't care about group order).
export function getVisibleAdminItems(ctx: AdminNavContext): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => isAdminItemVisible(item, ctx));
}
