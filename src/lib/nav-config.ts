// Single source of truth for every student-facing nav destination (top bar +
// Services launcher). Mirrors src/components/admin/AdminNav.tsx's grouped,
// filtered, "empty groups disappear" pattern, but as pure data + pure
// functions (no JSX) so both the pinned top-bar strip and the launcher grid
// read the SAME array — the old primaryLinks/secondaryLinks split in
// StudentNav.tsx duplicated this and let the two surfaces drift (secondaryLinks
// wasn't reachable from the mobile hamburger drawer at all). See the
// StudentNav redesign plan for the full rationale.
//
// `tier` decides whether an item is pinned in the top bar or lives one tap
// deeper in the launcher grid. Re-tiering the whole nav as the roadmap
// solidifies is a data edit here, not a component change.
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  CalendarDays,
  QrCode,
  Trophy,
  History,
  ShoppingBag,
  Users,
  Settings,
  MessageSquareWarning,
  GraduationCap,
} from "lucide-react";
import { houseSlug } from "@/lib/houses";

export type NavTier = "pinned" | "launcher";

// Everything a visibility/href predicate might need. Deliberately narrower
// than the full session user — add fields here only as items actually need
// them, so nav-config stays easy to unit-test with plain objects.
export interface NavContext {
  roles: string[];
  houseId: string | null;
  /** False for a signed-out visitor — see NavItem.guestVisible. */
  signedIn: boolean;
}

export interface NavItem {
  /** Stable id — React key, and lets render code special-case an item without href string-matching. */
  id: string;
  href: string | ((ctx: NavContext) => string);
  /** Key into the `t` translation map; caller falls back to `fallback` when a language is missing the key. */
  i18nKey: string;
  fallback: string;
  icon: LucideIcon;
  tier: NavTier;
  /** Which NAV_GROUPS bucket this renders under in the launcher. Ignored for tier:"pinned". */
  group: string;
  /** Omit = visible to every authenticated student. */
  visible?: (ctx: NavContext) => boolean;
  /**
   * True = also reachable by a signed-out visitor (mirrors what today's
   * StudentNav already exposes pre-login: Dashboard, Houses/Leaderboard as
   * top tabs, Digital ID via the guest dropdown). Everything else requires
   * a session by default.
   */
  guestVisible?: boolean;
  /**
   * No real destination yet (e.g. VOC, Study things — see redesign plan).
   * Renders as a disabled, non-navigating tile with a "coming soon" badge —
   * never a real <Link>, so it can never be a dead link. Flip this off and
   * set a real href in the same diff that ships the feature's actual route.
   */
  comingSoon?: boolean;
}

export interface NavGroupDef {
  id: string;
  /** i18n key for the group's section heading; null = ungrouped. */
  titleI18nKey: string | null;
}

// Render order for launcher groups. A group with zero visible items is
// dropped entirely (see getLauncherGroups) — same behavior as AdminNav.
export const NAV_GROUPS: NavGroupDef[] = [
  { id: "activities", titleI18nKey: "navGroupActivities" },
  { id: "feedback", titleI18nKey: "navGroupFeedback" },
  { id: "learning", titleI18nKey: "navGroupLearning" },
  { id: "account", titleI18nKey: "navGroupAccount" },
];

export const NAV_ITEMS: NavItem[] = [
  // Pinned: kept in the top bar on every viewport. Digital ID is pinned
  // deliberately (not launcher-tier) — it's a physically time-pressured
  // action (student holds up the QR at a live check-in queue), so it must
  // stay reachable in a single tap rather than a tap-then-scan-a-grid.
  { id: "dashboard", href: "/dashboard", i18nKey: "upcomingEvents", fallback: "Dashboard", icon: LayoutDashboard, tier: "pinned", group: "activities", guestVisible: true },
  { id: "calendar", href: "/dashboard/calendar", i18nKey: "calendar", fallback: "Calendar", icon: CalendarDays, tier: "pinned", group: "activities" },
  { id: "digitalId", href: "/dashboard/id", i18nKey: "digitalId", fallback: "Digital ID", icon: QrCode, tier: "pinned", group: "activities", guestVisible: true },

  // Launcher — Activities group.
  { id: "houses", href: "/dashboard/houses", i18nKey: "leaderboard", fallback: "Houses", icon: Trophy, tier: "launcher", group: "activities", guestVisible: true },
  { id: "history", href: "/dashboard/history", i18nKey: "eventHistory", fallback: "History", icon: History, tier: "launcher", group: "activities" },
  { id: "shop", href: "/dashboard/shop", i18nKey: "shop", fallback: "Shop", icon: ShoppingBag, tier: "launcher", group: "activities" },

  // Launcher — Account group.
  {
    id: "myHouse",
    href: (ctx) => `/dashboard/houses/${houseSlug(ctx.houseId)}`,
    i18nKey: "myHouse",
    fallback: "My House",
    icon: Users,
    tier: "launcher",
    group: "account",
    visible: (ctx) => !!ctx.houseId,
  },
  { id: "profile", href: "/dashboard/profile", i18nKey: "editProfile", fallback: "Profile", icon: Settings, tier: "launcher", group: "account" },

  // Launcher — "Study things" has no route or data model yet (confirmed
  // against the codebase during the redesign plan) — it stays a placeholder
  // so the IA can be previewed before that feature is built. VOC (Feedback &
  // Complaints) shipped — see docs/features/feedback-complaints.md — and is
  // a real route now, no longer comingSoon.
  { id: "voc", href: "/feedback/new", i18nKey: "vocFeedback", fallback: "Feedback", icon: MessageSquareWarning, tier: "launcher", group: "feedback" },
  { id: "study", href: "#", i18nKey: "studyResources", fallback: "Study", icon: GraduationCap, tier: "launcher", group: "learning", comingSoon: true },
];

export function resolveHref(item: NavItem, ctx: NavContext): string {
  return typeof item.href === "function" ? item.href(ctx) : item.href;
}

export function isItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (!ctx.signedIn && !item.guestVisible) return false;
  return item.visible ? item.visible(ctx) : true;
}

export function getPinnedItems(ctx: NavContext): NavItem[] {
  return NAV_ITEMS.filter((item) => item.tier === "pinned" && isItemVisible(item, ctx));
}

export interface LauncherGroup extends NavGroupDef {
  items: NavItem[];
}

export function getLauncherGroups(ctx: NavContext): LauncherGroup[] {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: NAV_ITEMS.filter((item) => item.tier === "launcher" && item.group === group.id && isItemVisible(item, ctx)),
    }))
    .filter((group) => group.items.length > 0);
}

// Full launcher content: pinned items first as an ungrouped section (mirrors
// AdminNav's ungrouped "Overview" item ahead of its grouped sections), then
// the launcher-tier groups. On mobile there's no separate persistent top bar
// to surface pinned items, so the launcher must include them too — on
// desktop this is deliberate redundancy with the top-bar strip, same
// tradeoff AdminNav makes by listing Overview in the sidebar even though
// it's also the default landing page.
export function getAllGroups(ctx: NavContext): LauncherGroup[] {
  const pinned = getPinnedItems(ctx);
  const groups = getLauncherGroups(ctx);
  return pinned.length > 0 ? [{ id: "pinned", titleI18nKey: null, items: pinned }, ...groups] : groups;
}
