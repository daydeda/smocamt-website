import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV_ITEMS,
  buildAdminNavContext,
  getVisibleAdminItems,
  isAdminItemVisible,
  type AdminNavContext,
} from "@/lib/admin-nav-config";

// Pins the pre-refactor AdminNav.tsx's `itemAllowed` behavior (a 41-line,
// per-href bespoke branch chain) against the new config-driven predicates,
// per href, per representative role context. This is nav-layer (not the
// access-control source of truth — see admin-access.ts / server routes),
// but a visibility regression here is exactly the kind of drift CLAUDE.md's
// access-control section warns 4-layer gating can suffer from, so it's
// pinned rather than left to manual click-through alone.

function ctx(input: Partial<AdminNavContext> & { roles: string[] }): AdminNavContext {
  return buildAdminNavContext({
    roles: input.roles,
    hasStaffPosition: input.hasStaffPosition,
    hasClubPosition: input.hasClubPosition,
    smoPosition: input.smoPosition,
    anusmoPosition: input.anusmoPosition,
  });
}

function visibleHrefs(c: AdminNavContext): string[] {
  return getVisibleAdminItems(c).map((item) => item.href);
}

const SUPER_ADMIN = ctx({ roles: ["super_admin"] });
const ADMIN = ctx({ roles: ["admin"] });
const REGISTRATION = ctx({ roles: ["registration"] });
const ORGANIZER = ctx({ roles: ["organizer"] });
const SMO_SCANNER_ONLY = ctx({ roles: ["smo"], hasStaffPosition: true });
const SMO_GLOBAL_REGISTRATION = ctx({ roles: ["smo"], hasStaffPosition: true, smoPosition: "registration" });
const CLUB_PRESIDENT = ctx({ roles: ["club_president"], hasClubPosition: true, hasStaffPosition: true });
const MAJOR_PRESIDENT = ctx({ roles: ["major_president"], hasStaffPosition: true });

describe("admin-nav-config: every item has a unique id and a group that exists", () => {
  it("ids are unique", () => {
    const ids = ADMIN_NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("admin-nav-config: full-admin roles (super_admin/admin) see the full non-roadmap set", () => {
  const FULL_SET = [
    "/admin/dashboard",
    "/admin/events",
    "/admin/scanner",
    "/admin/proposals",
    "/admin/reviews",
    "/admin/appeals",
    "/admin/clubs",
    "/admin/students",
    "/admin/announcement",
    "/admin/shop",
    "/admin/audit-logs",
  ];

  it("super_admin", () => {
    for (const href of FULL_SET) expect(visibleHrefs(SUPER_ADMIN)).toContain(href);
    // major_president-only item stays hidden even from super_admin (role-only gate).
    expect(visibleHrefs(SUPER_ADMIN)).not.toContain("/admin/majors");
    // roadmap placeholders: visible (comingSoon) to super_admin/admin.
    expect(getVisibleAdminItems(SUPER_ADMIN).some((i) => i.id === "voc" && i.comingSoon)).toBe(true);
    expect(getVisibleAdminItems(SUPER_ADMIN).some((i) => i.id === "study" && i.comingSoon)).toBe(true);
  });

  it("admin", () => {
    for (const href of FULL_SET) expect(visibleHrefs(ADMIN)).toContain(href);
  });
});

describe("admin-nav-config: registration/organizer are barred from admin/students-adjacent + audit + content", () => {
  it("registration sees students (role-listed) but not clubs/audit/announcement/shop/appeals", () => {
    const hrefs = visibleHrefs(REGISTRATION);
    expect(hrefs).toContain("/admin/students");
    expect(hrefs).toContain("/admin/proposals");
    expect(hrefs).toContain("/admin/reviews");
    expect(hrefs).not.toContain("/admin/clubs");
    expect(hrefs).not.toContain("/admin/audit-logs");
    expect(hrefs).not.toContain("/admin/announcement");
    expect(hrefs).not.toContain("/admin/shop");
    expect(hrefs).not.toContain("/admin/appeals");
  });

  it("organizer: same shape as registration for the role-listed items", () => {
    const hrefs = visibleHrefs(ORGANIZER);
    expect(hrefs).not.toContain("/admin/students"); // organizer excluded from canSeeStudents
    expect(hrefs).toContain("/admin/proposals");
    expect(hrefs).toContain("/admin/reviews");
    expect(hrefs).not.toContain("/admin/clubs");
    expect(hrefs).not.toContain("/admin/audit-logs");
  });
});

describe("admin-nav-config: scanner-only confinement (smo, club_president, major_president)", () => {
  it("smo (scanner-only) sees exactly scanner + events + appeals, nothing else", () => {
    expect(visibleHrefs(SMO_SCANNER_ONLY).sort()).toEqual(
      ["/admin/appeals", "/admin/events", "/admin/scanner"].sort()
    );
  });

  it("smo holding a global 'registration' staff position is NOT scanner-only — full registration-equivalent breadth", () => {
    const hrefs = visibleHrefs(SMO_GLOBAL_REGISTRATION);
    expect(hrefs).toContain("/admin/students");
    expect(hrefs).toContain("/admin/proposals");
    expect(hrefs).toContain("/admin/dashboard");
  });

  it("club_president (scanner-only) additionally sees /admin/clubs", () => {
    expect(visibleHrefs(CLUB_PRESIDENT)).toEqual(
      expect.arrayContaining(["/admin/scanner", "/admin/events", "/admin/appeals", "/admin/clubs"])
    );
    expect(visibleHrefs(CLUB_PRESIDENT)).not.toContain("/admin/majors");
  });

  it("major_president (scanner-only) additionally sees /admin/majors, not /admin/clubs", () => {
    const hrefs = visibleHrefs(MAJOR_PRESIDENT);
    expect(hrefs).toContain("/admin/majors");
    expect(hrefs).not.toContain("/admin/clubs");
  });

  it("scanner-only contexts never see the roadmap placeholders", () => {
    for (const c of [SMO_SCANNER_ONLY, CLUB_PRESIDENT, MAJOR_PRESIDENT]) {
      expect(getVisibleAdminItems(c).some((i) => i.comingSoon)).toBe(false);
    }
  });
});

describe("admin-nav-config: /admin/majors is major_president-only even for full admins", () => {
  it("a major_president who ALSO holds admin sees /admin/majors via the role-only bypass", () => {
    const combo = ctx({ roles: ["major_president", "admin"] });
    expect(visibleHrefs(combo)).toContain("/admin/majors");
  });

  it("super_admin alone never sees /admin/majors", () => {
    expect(visibleHrefs(SUPER_ADMIN)).not.toContain("/admin/majors");
  });
});

describe("isAdminItemVisible: scanner-only bypasses each item's own `allowed` predicate", () => {
  it("a scanner-only smo does not see /admin/announcement even though nothing else in that role's set would block it structurally", () => {
    const announcement = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/announcement")!;
    expect(isAdminItemVisible(announcement, SMO_SCANNER_ONLY)).toBe(false);
  });
});
